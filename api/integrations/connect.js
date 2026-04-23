// POST /api/integrations/connect
// Save per-integration config + the NAME of the env var that holds its
// client secret. The actual secret value is never stored in Postgres — we
// only store the pointer, so rotating the secret is a `vercel env` op.
//
// Body: { provider, config, credential_ref }

import crypto from "node:crypto";
import { rateLimit, hardenResponse, requestId, fail, json, redactSecrets } from "../_lib/security.js";
import { sbGet, sbPatch, writeAudit } from "../_lib/supabase.js";
import { requireAuth } from "../_lib/auth.js";

const ALLOWED_PROVIDERS = new Set(["microsoft_teams", "salesforce"]);

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "integrations-connect");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);
  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
    if (!body || typeof body !== "object") throw new Error();
  } catch { return fail(res, 400, "Invalid JSON body."); }

  const { provider, config, credential_ref } = body;
  if (!ALLOWED_PROVIDERS.has(provider)) return fail(res, 400, "Unsupported provider.");
  if (config && typeof config !== "object") return fail(res, 400, "config must be an object.");
  if (credential_ref && !/^[A-Z][A-Z0-9_]{2,63}$/.test(String(credential_ref))) {
    return fail(res, 400, "credential_ref must look like an env var name (A-Z0-9_).");
  }

  // Only keep a small allowlist of config keys per provider so random payload
  // fields can't pollute the integrations row.
  const safeConfig = sanitizeConfig(provider, config || {});

  try {
    const existing = await sbGet("integrations", { provider: "eq." + provider, select: "*" });
    if (!existing || !existing.length) return fail(res, 404, "Integration not registered.");
    const row = existing[0];

    const secretForWebhook = crypto.randomBytes(32).toString("hex"); // new HMAC secret per connect
    const updated = await sbPatch("integrations", { id: "eq." + row.id }, {
      config: safeConfig,
      credential_ref: credential_ref || null,
      webhook_secret: secretForWebhook,
      status: "connected",
      last_error: null,
    });

    writeAudit({
      actor: session.user || "unknown", actor_role: session.role || "user",
      action: "integration.configure",
      target_table: "integrations", target_id: row.id,
      before_state: redactSecrets(row), after_state: redactSecrets(updated?.[0] || null),
      request_id: rid,
      metadata: { provider, credential_ref_name: credential_ref || null },
    });

    // Return the NEW webhook secret exactly once so the admin can paste it
    // into the external system. After this response the secret is only
    // retrievable server-side (RLS hides it from the anon key).
    return json(res, 200, {
      ok: true,
      provider,
      status: "connected",
      webhook_secret: secretForWebhook,
      webhook_url: (process.env.APP_URL || "") + "/api/integrations/" + provider + "/webhook",
      request_id: rid,
    });
  } catch (err) {
    console.error("[integrations.connect]", err && err.message);
    return fail(res, 500, "Failed to save integration.");
  }
}

function sanitizeConfig(provider, config) {
  const out = {};
  const allowedByProvider = {
    microsoft_teams: ["tenant_id", "client_id"],
    salesforce:      ["instance_url", "client_id"],
  };
  for (const key of allowedByProvider[provider] || []) {
    const v = config[key];
    if (typeof v === "string" && v.length < 400) out[key] = v.trim();
  }
  return out;
}
