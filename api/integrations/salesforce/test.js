// POST /api/integrations/salesforce/test
// Lightweight connection check — requests an OAuth token without pulling any
// data.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, writeAudit } from "../../_lib/supabase.js";
import { requireAuth } from "../../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "salesforce-test", 2);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.salesforce", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration) return fail(res, 404, "Integration not registered.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.instance_url || !cfg.client_id || !secret) {
    return json(res, 200, { ok: false, error: "Missing instance_url, client_id, or secret." });
  }

  try {
    const r = await fetch(cfg.instance_url.replace(/\/$/, "") + "/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.client_id,
        client_secret: secret,
      }).toString(),
    });
    const ok = r.ok;
    writeAudit({
      actor: "milesdemo", actor_role: "demo",
      action: "integration.test", target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "salesforce", ok, http_status: r.status },
    });
    return json(res, 200, { ok, detail: ok ? "Token acquired." : (await r.text().catch(() => "failed")).slice(0, 200), records_upserted: 0 });
  } catch (err) {
    return fail(res, 502, "Test failed: " + (err.message || "unknown").slice(0, 200));
  }
}
