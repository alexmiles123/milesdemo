// POST /api/integrations/teams/webhook
// Inbound webhook receiver for Microsoft Graph change-notifications.
//
// Microsoft Graph delivers two kinds of requests to this endpoint:
//   1. The initial validation handshake — it passes `?validationToken=...`
//      and expects that token echoed back as text/plain within 10s.
//   2. Real notifications — JSON body with a `value` array of change events,
//      and a clientState header/field that must match a secret we set at
//      subscription-creation time. We repurpose integrations.webhook_secret
//      for this, and MS Graph sends it back in `clientState`.
//
// For non-Graph clients (e.g. Logic Apps, Power Automate), this route also
// accepts a standard HMAC signature: header `X-Signature: sha256=<hex>` over
// the raw request body, using integrations.webhook_secret as the key.

import { rateLimit, hardenResponse, requestId, fail, json, verifyHmac, readRawBody } from "../../_lib/security.js";
import { sbGet, sbPost, sbUpsert, writeAudit } from "../../_lib/supabase.js";

export const config = { api: { bodyParser: false } }; // we need the raw body for HMAC

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  // Graph validation handshake: MUST return within 10 seconds, text/plain.
  if (req.method === "POST" && req.url && req.url.includes("validationToken=")) {
    const token = new URL(req.url, "http://x").searchParams.get("validationToken");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    return res.end(token || "");
  }

  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "teams-webhook", 1);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const rid = requestId(req);
  const rawBody = await readRawBody(req);
  if (rawBody.length > 1_000_000) return fail(res, 413, "Payload too large.");

  let payload;
  try { payload = JSON.parse(rawBody || "{}"); }
  catch { return fail(res, 400, "Invalid JSON."); }

  // Load the integration row so we know the webhook secret.
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.microsoft_teams", select: "*" });
    integration = rows && rows[0];
  } catch (err) {
    console.error("[teams.webhook] lookup failed", err.message);
    return fail(res, 500, "Integration lookup failed.");
  }
  if (!integration || integration.status !== "connected") {
    return fail(res, 404, "Teams integration is not connected.");
  }
  const secret = integration.webhook_secret || "";

  // Verify — either clientState (Graph) or HMAC (generic).
  const sigHeader = req.headers["x-signature"] || req.headers["x-hub-signature-256"];
  const clientStates = (payload.value || []).map((v) => v && v.clientState).filter(Boolean);
  const clientStateOk = clientStates.length > 0 && clientStates.every((cs) => cs === secret);
  const hmacOk = sigHeader && verifyHmac(rawBody, sigHeader, secret);
  if (!clientStateOk && !hmacOk) {
    writeAudit({
      actor: "system", actor_role: "webhook",
      action: "integration.webhook.rejected",
      target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "microsoft_teams", reason: "bad signature" },
    });
    return fail(res, 401, "Signature verification failed.");
  }

  // Open a sync_run so we can observe outcomes.
  let runId = null;
  try {
    const run = await sbPost("sync_runs", [{
      integration_id: integration.id,
      trigger: "webhook",
      status: "running",
      request_id: rid,
    }]);
    runId = run?.[0]?.id;
  } catch { /* not fatal */ }

  // Normalize and upsert each notification as a customer_interaction.
  const events = Array.isArray(payload.value) ? payload.value : [];
  let upserted = 0, skipped = 0;
  for (const ev of events) {
    try {
      const row = normalizeTeamsEvent(ev);
      if (!row) { skipped++; continue; }
      await sbUpsert("customer_interactions", [row], "source_system,external_id");
      upserted++;
    } catch (e) {
      console.error("[teams.webhook] row failed", e && e.message);
      skipped++;
    }
  }

  if (runId) {
    await sbUpsert("sync_runs", [{ id: runId, status: skipped === 0 ? "succeeded" : (upserted === 0 ? "failed" : "partial"), finished_at: new Date().toISOString(), records_in: events.length, records_upserted: upserted, records_skipped: skipped }], "id").catch(() => {});
  }
  await sbUpsert("integrations", [{ id: integration.id, last_sync_at: new Date().toISOString(), status: "connected", last_error: null }], "id").catch(() => {});

  return json(res, 200, { ok: true, records_in: events.length, records_upserted: upserted, records_skipped: skipped, request_id: rid });
}

// Map a Graph change-notification to a customer_interactions row. This is
// deliberately defensive — if fields are missing we drop the event rather
// than write garbage. A real integration pass would expand the mapping to
// call Graph's /communications and /messages endpoints to hydrate bodies.
function normalizeTeamsEvent(ev) {
  if (!ev || !ev.resource) return null;
  const resource = String(ev.resource || "");
  const isCall    = /\/communications\/callRecords\//i.test(resource);
  const isMessage = /\/chats\/.*\/messages\//i.test(resource) || /\/teams\/.*\/channels\/.*\/messages\//i.test(resource);
  const isMeeting = /\/onlineMeetings\//i.test(resource);
  const kind = isCall ? "call" : isMeeting ? "meeting" : isMessage ? "message" : null;
  if (!kind) return null;

  const external_id = ev.resourceData?.id || resource;
  return {
    source_system: "microsoft_teams",
    external_id:   String(external_id).slice(0, 400),
    interaction_type: kind,
    subject:       ev.resourceData?.subject || null,
    body:          null,
    occurred_at:   ev.subscriptionExpirationDateTime || new Date().toISOString(),
    participants:  [],
    raw_payload:   ev,
  };
}
