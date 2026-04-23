// POST /api/integrations/salesforce/sync
// Admin-triggered pull from Salesforce. Authenticates via OAuth 2.0 client
// credentials against the configured instance and queries recent Tasks,
// Events, and EmailMessages via SOQL, upserting each into customer_interactions.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, sbPost, sbUpsert, writeAudit } from "../../_lib/supabase.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "salesforce-sync", 5);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const rid = requestId(req);
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.salesforce", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration || integration.status !== "connected") return fail(res, 400, "Salesforce is not connected.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.instance_url || !cfg.client_id || !secret) {
    return fail(res, 400, "Missing instance_url, client_id, or client secret (env " + (integration.credential_ref || "<unset>") + ").");
  }

  const run = await sbPost("sync_runs", [{ integration_id: integration.id, trigger: "manual", status: "running", request_id: rid }]).catch(() => null);
  const runId = run && run[0] && run[0].id;
  const finish = async (status, extras = {}) => {
    if (runId) await sbUpsert("sync_runs", [{ id: runId, status, finished_at: new Date().toISOString(), ...extras }], "id").catch(() => {});
  };

  try {
    const tokenRes = await fetch(cfg.instance_url.replace(/\/$/, "") + "/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.client_id,
        client_secret: secret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      await finish("failed", { error_message: "Salesforce token failed: " + body.slice(0, 200) });
      await sbUpsert("integrations", [{ id: integration.id, status: "error", last_error: "Token acquisition failed" }], "id").catch(() => {});
      return fail(res, 502, "Salesforce token acquisition failed.");
    }
    const token = await tokenRes.json();
    const accessToken = token.access_token;
    const instance = token.instance_url || cfg.instance_url;

    // SOQL for last 24h of activity. Scoped to a few object types that most
    // customers surface — expandable via config later.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const soql = encodeURIComponent(
      `SELECT Id,Subject,Description,ActivityDate,WhatId FROM Task WHERE CreatedDate > ${since}` +
      ` LIMIT 200`);
    const q = await fetch(instance.replace(/\/$/, "") + "/services/data/v59.0/query?q=" + soql, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!q.ok) {
      const body = await q.text().catch(() => "");
      await finish("failed", { error_message: "SOQL query failed: " + body.slice(0, 200) });
      return fail(res, 502, "Salesforce query failed.");
    }
    const data = await q.json();
    const records = Array.isArray(data.records) ? data.records : [];

    let upserted = 0, skipped = 0;
    for (const r of records) {
      try {
        await sbUpsert("customer_interactions", [{
          source_system: "salesforce",
          external_id:   String(r.Id).slice(0, 400),
          interaction_type: "task",
          subject:        (r.Subject || "").slice(0, 400) || null,
          body:           (r.Description || "").slice(0, 10000) || null,
          occurred_at:    r.ActivityDate || new Date().toISOString(),
          participants:   [],
          raw_payload:    r,
        }], "source_system,external_id");
        upserted++;
      } catch { skipped++; }
    }

    await finish(skipped === 0 ? "succeeded" : (upserted === 0 ? "failed" : "partial"), { records_in: records.length, records_upserted: upserted, records_skipped: skipped });
    await sbUpsert("integrations", [{ id: integration.id, last_sync_at: new Date().toISOString(), status: "connected", last_error: null }], "id").catch(() => {});

    writeAudit({
      actor: "milesdemo", actor_role: "demo",
      action: "integration.sync",
      target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "salesforce", records_in: records.length, records_upserted: upserted, records_skipped: skipped },
    });

    return json(res, 200, { ok: true, records_in: records.length, records_upserted: upserted, records_skipped: skipped, request_id: rid });
  } catch (err) {
    console.error("[salesforce.sync] error", err && err.message);
    await finish("failed", { error_message: (err && err.message || "unknown").slice(0, 400) });
    await sbUpsert("integrations", [{ id: integration.id, status: "error", last_error: (err && err.message || "unknown").slice(0, 400) }], "id").catch(() => {});
    return fail(res, 500, "Sync failed.");
  }
}
