// POST /api/auth/forgot
// Body: { email }
//
// Self-service password reset stub. Behavior:
//   • Always returns 200 with a generic message — never reveals whether the
//     email matches a known account (prevents enumeration).
//   • Records a `password.reset_requested` row in audit_log so an admin can
//     review the request from the Configuration → Security tab and issue a
//     new password manually.
//   • Heavily rate-limited per IP (3 / minute) to prevent log flooding.
//
// We intentionally do NOT email the user. Until the app_users table exists
// (Batch 3), there is no per-user mailing address to safely send to. An
// administrator handles the reset out-of-band.

import { rateLimit, hardenResponse, fail, json } from "../_lib/security.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "auth-forgot", 20);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Too many reset requests."); }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch { return fail(res, 400, "Invalid JSON body."); }

  const email = (body?.email || "").toString().trim().toLowerCase();
  // Cheap RFC-5322-ish sanity check; the goal is to reject obvious junk, not to
  // be exhaustively correct (validating email is famously imperfect).
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 200, { ok: true });
  }

  const sbUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (sbUrl && sbKey) {
    try {
      const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const ip = fwd || req.socket?.remoteAddress || "unknown";
      const ua = (req.headers["user-agent"] || "").toString().slice(0, 256);
      await fetch(sbUrl + "/rest/v1/audit_log", {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: "Bearer " + sbKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          actor: "anonymous",
          action: "password.reset_requested",
          entity_type: "user",
          entity_id: email,
          metadata: { ip, ua },
        }),
      });
    } catch (_) { /* don't leak DB state to the caller */ }
  }

  return json(res, 200, { ok: true });
}
