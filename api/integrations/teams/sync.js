// POST /api/integrations/teams/sync
// Admin-triggered backfill. Calls Microsoft Graph with the client-credentials
// flow, pulls recent callRecords and online meetings, and upserts them into
// customer_interactions. Idempotent via (source_system, external_id).
//
// Secrets: reads process.env[integration.credential_ref] for the client
// secret — it is NEVER passed from the browser.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, sbPost, sbUpsert, writeAudit } from "../../_lib/supabase.js";
import { requireAuth } from "../../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "teams-sync", 5);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.microsoft_teams", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration || integration.status !== "connected") return fail(res, 400, "Teams integration is not connected.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.tenant_id || !cfg.client_id || !secret) {
    return fail(res, 400, "Missing tenant_id, client_id, or client secret (env " + (integration.credential_ref || "<unset>") + ").");
  }

  // Open a sync_run early so failures are observable.
  const run = await sbPost("sync_runs", [{ integration_id: integration.id, trigger: "manual", status: "running", request_id: rid }]).catch(() => null);
  const runId = run && run[0] && run[0].id;

  const finish = async (status, extras = {}) => {
    if (runId) {
      await sbUpsert("sync_runs", [{ id: runId, status, finished_at: new Date().toISOString(), ...extras }], "id").catch(() => {});
    }
  };

  try {
    // Acquire an access token via client_credentials.
    const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant_id)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: secret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      await finish("failed", { error_message: "Token acquisition failed: " + body.slice(0, 200) });
      await sbUpsert("integrations", [{ id: integration.id, status: "error", last_error: "Token acquisition failed" }], "id").catch(() => {});
      return fail(res, 502, "Microsoft token acquisition failed.");
    }
    const { access_token } = await tokenRes.json();

    // Pull call records from the last 24 hours.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const callsRes = await fetch("https://graph.microsoft.com/v1.0/communications/callRecords?$filter=startDateTime ge " + since, {
      headers: { Authorization: "Bearer " + access_token },
    });
    if (!callsRes.ok) {
      const body = await callsRes.text().catch(() => "");
      await finish("failed", { error_message: "Graph query failed: " + body.slice(0, 200) });
      return fail(res, 502, "Graph API query failed.");
    }
    const calls = await callsRes.json();
    const value = Array.isArray(calls.value) ? calls.value : [];

    let upserted = 0, skipped = 0;
    for (const c of value) {
      try {
        await sbUpsert("customer_interactions", [{
          source_system: "microsoft_teams",
          external_id:   String(c.id).slice(0, 400),
          interaction_type: "call",
          subject:        c.type || "Teams Call",
          occurred_at:    c.startDateTime || new Date().toISOString(),
          duration_seconds: c.endDateTime && c.startDateTime
            ? Math.max(0, Math.round((new Date(c.endDateTime).getTime() - new Date(c.startDateTime).getTime()) / 1000))
            : null,
          participants:   Array.isArray(c.participants) ? c.participants.slice(0, 50) : [],
          raw_payload:    c,
        }], "source_system,external_id");
        upserted++;
      } catch { skipped++; }
    }

    await finish(skipped === 0 ? "succeeded" : (upserted === 0 ? "failed" : "partial"), { records_in: value.length, records_upserted: upserted, records_skipped: skipped });
    await sbUpsert("integrations", [{ id: integration.id, last_sync_at: new Date().toISOString(), status: "connected", last_error: null }], "id").catch(() => {});

    writeAudit({
      actor: "milesdemo", actor_role: "demo",
      action: "integration.sync",
      target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "microsoft_teams", records_in: value.length, records_upserted: upserted, records_skipped: skipped },
    });

    return json(res, 200, { ok: true, records_in: value.length, records_upserted: upserted, records_skipped: skipped, request_id: rid });
  } catch (err) {
    console.error("[teams.sync] unexpected error", err && err.message);
    await finish("failed", { error_message: (err && err.message || "unknown").slice(0, 400) });
    await sbUpsert("integrations", [{ id: integration.id, status: "error", last_error: (err && err.message || "unknown").slice(0, 400) }], "id").catch(() => {});
    return fail(res, 500, "Sync failed.");
  }
}
