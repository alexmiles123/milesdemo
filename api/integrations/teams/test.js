// POST /api/integrations/teams/test
// Lightweight check that the Teams integration is configured correctly:
// fetches an OAuth token from Azure AD without pulling any data. Used by the
// "Test" button in the Integrations tab.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, writeAudit } from "../../_lib/supabase.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "teams-test", 2);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const rid = requestId(req);
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.microsoft_teams", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration) return fail(res, 404, "Integration not registered.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.tenant_id || !cfg.client_id || !secret) {
    return json(res, 200, { ok: false, error: "Missing tenant_id, client_id, or secret." });
  }

  try {
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
    const ok = tokenRes.ok;
    const detail = ok ? "Token acquired." : await tokenRes.text().catch(() => "failed");
    writeAudit({
      actor: "milesdemo", actor_role: "demo",
      action: "integration.test", target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "microsoft_teams", ok, http_status: tokenRes.status },
    });
    return json(res, 200, { ok, detail: ok ? "Token acquired." : (detail || "Token request failed").slice(0, 200), records_upserted: 0 });
  } catch (err) {
    return fail(res, 502, "Test failed: " + (err.message || "unknown").slice(0, 200));
  }
}
