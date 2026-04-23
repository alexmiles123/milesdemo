// POST /api/integrations/salesforce/webhook
// Receives Outbound-Message-style payloads (or any signed POST) from
// Salesforce. The sender must include an `X-Signature: sha256=<hex>` header
// computed over the raw body using integrations.webhook_secret as the key.
//
// Typical payload shape (normalized):
//   {
//     "events": [
//       { "type": "Account" | "Opportunity" | "Task" | "Event" | "EmailMessage",
//         "id": "...", "subject": "...", "body": "...", "occurred_at": "...",
//         "project_external_id": "...", "participants": [...] }
//     ]
//   }

import { rateLimit, hardenResponse, requestId, fail, json, verifyHmac, readRawBody } from "../../_lib/security.js";
import { sbGet, sbPost, sbUpsert, writeAudit } from "../../_lib/supabase.js";

export const config = { api: { bodyParser: false } };

const TYPE_MAP = {
  Task:          "task",
  Event:         "meeting",
  EmailMessage:  "email",
  ContentNote:   "note",
  Call:          "call",
  Opportunity:   "note",
  Account:       "note",
};

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "salesforce-webhook");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const rid = requestId(req);
  const rawBody = await readRawBody(req);
  if (rawBody.length > 1_000_000) return fail(res, 413, "Payload too large.");

  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.salesforce", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration || integration.status !== "connected") return fail(res, 404, "Salesforce integration is not connected.");

  const secret = integration.webhook_secret || "";
  const sigHeader = req.headers["x-signature"] || req.headers["x-hub-signature-256"];
  if (!verifyHmac(rawBody, sigHeader, secret)) {
    writeAudit({
      actor: "system", actor_role: "webhook",
      action: "integration.webhook.rejected",
      target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "salesforce", reason: "bad signature" },
    });
    return fail(res, 401, "Signature verification failed.");
  }

  let payload;
  try { payload = JSON.parse(rawBody || "{}"); }
  catch { return fail(res, 400, "Invalid JSON."); }
  const events = Array.isArray(payload.events) ? payload.events : [];

  const run = await sbPost("sync_runs", [{ integration_id: integration.id, trigger: "webhook", status: "running", request_id: rid }]).catch(() => null);
  const runId = run && run[0] && run[0].id;

  // Map incoming project_external_id → projects.id by looking in
  // projects.external_ids ->> 'salesforce'. We do one lookup per batch
  // since cardinality is usually small, and cache in a Map.
  const externalIds = Array.from(new Set(events.map(e => e && e.project_external_id).filter(Boolean)));
  const projectMap = new Map();
  if (externalIds.length) {
    for (const xid of externalIds) {
      try {
        const rows = await sbGet("projects", { select: "id,external_ids", "external_ids->>salesforce": "eq." + xid });
        if (rows && rows[0]) projectMap.set(xid, rows[0].id);
      } catch { /* no match */ }
    }
  }

  let upserted = 0, skipped = 0;
  for (const ev of events) {
    try {
      if (!ev || !ev.id || !ev.type) { skipped++; continue; }
      const interactionType = TYPE_MAP[ev.type] || "note";
      await sbUpsert("customer_interactions", [{
        source_system: "salesforce",
        external_id:   String(ev.id).slice(0, 400),
        project_id:    ev.project_external_id ? (projectMap.get(ev.project_external_id) || null) : null,
        interaction_type: interactionType,
        subject:       (ev.subject || "").slice(0, 400) || null,
        body:          (ev.body || "").slice(0, 10000) || null,
        occurred_at:   ev.occurred_at || new Date().toISOString(),
        participants:  Array.isArray(ev.participants) ? ev.participants.slice(0, 50) : [],
        raw_payload:   ev,
      }], "source_system,external_id");
      upserted++;
    } catch (e) {
      console.error("[salesforce.webhook] row failed", e && e.message);
      skipped++;
    }
  }

  if (runId) {
    await sbUpsert("sync_runs", [{ id: runId, status: skipped === 0 ? "succeeded" : (upserted === 0 ? "failed" : "partial"), finished_at: new Date().toISOString(), records_in: events.length, records_upserted: upserted, records_skipped: skipped }], "id").catch(() => {});
  }
  await sbUpsert("integrations", [{ id: integration.id, last_sync_at: new Date().toISOString(), status: "connected", last_error: null }], "id").catch(() => {});

  return json(res, 200, { ok: true, records_in: events.length, records_upserted: upserted, records_skipped: skipped, request_id: rid });
}
