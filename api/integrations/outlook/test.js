// POST /api/integrations/outlook/test
// Verifies the Outlook integration is configured correctly by acquiring an
// OAuth 2.0 client-credentials token from Azure AD. No mail is read.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, writeAudit } from "../../_lib/supabase.js";
import { requireAuth } from "../../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "outlook-test", 2);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.outlook", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration) return fail(res, 404, "Integration not registered.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.tenant_id || !cfg.client_id || !secret) {
    return json(res, 200, { ok: false, error: "Missing tenant_id, client_id, or client secret env var." });
  }

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant_id)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     cfg.client_id,
          client_secret: secret,
          grant_type:    "client_credentials",
          scope:         "https://graph.microsoft.com/.default",
        }).toString(),
      },
    );
    const ok = tokenRes.ok;
    const detail = ok ? "Token acquired." : await tokenRes.text().catch(() => "failed");
    writeAudit({
      actor: session.user || "unknown", actor_role: session.role || "user",
      action: "integration.test", target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "outlook", ok, http_status: tokenRes.status },
    });
    return json(res, 200, {
      ok,
      detail: ok ? "Token acquired." : (detail || "Token request failed").slice(0, 200),
      records_upserted: 0,
    });
  } catch (err) {
    return fail(res, 502, "Test failed: " + (err.message || "unknown").slice(0, 200));
  }
}
