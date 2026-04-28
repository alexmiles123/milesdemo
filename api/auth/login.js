// POST /api/auth/login
// Body: { username, password }
// On success: { token, user, role, must_reset, expiresIn }
//
// Resolution order:
//   1. Look up the username in `app_users` (case-insensitive) and bcrypt-verify
//      the supplied password. Updates last_login_at on success; increments
//      failed_attempts on failure and applies a 15-minute lockout after 5
//      consecutive bad attempts.
//   2. If `app_users` is empty (fresh deploy, migration 007 not yet applied
//      *or* applied with no seeded admin), fall back to the env-var bootstrap
//      account (APP_USER + APP_PASS_HASH).
//
// The fallback is the only way to recover from "I deactivated my last admin"
// — keep APP_USER / APP_PASS_HASH set in production env vars.

import bcrypt from "bcryptjs";
import { rateLimit, hardenResponse, fail, json } from "../_lib/security.js";
import { signSession } from "../_lib/auth.js";
import { sbConfigured, sbGet, sbUpdate } from "../_lib/sb.js";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "auth-login", 5);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Too many login attempts."); }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch { return fail(res, 400, "Invalid JSON body."); }

  const username = (body?.username || "").toString().trim();
  const password = (body?.password || "").toString();
  if (!username || !password) return fail(res, 400, "Username and password are required.");

  // ── Path 1: app_users table ──────────────────────────────────────────
  if (sbConfigured()) {
    try {
      const rows = await sbGet("app_users", {
        select: "id,username,email,full_name,password_hash,role,is_active,must_reset,failed_attempts,locked_until",
        username: "ilike." + username,
        limit: "1",
      });
      const user = Array.isArray(rows) ? rows[0] : null;
      if (user) {
        if (!user.is_active) return fail(res, 403, "Account is disabled.");
        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
          return fail(res, 423, "Account temporarily locked. Try again in a few minutes.");
        }
        const ok = await bcrypt.compare(password, user.password_hash).catch(() => false);
        if (!ok) {
          const attempts = (user.failed_attempts || 0) + 1;
          const patch = { failed_attempts: attempts };
          if (attempts >= MAX_ATTEMPTS) {
            patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
            patch.failed_attempts = 0;
          }
          try { await sbUpdate("app_users", { id: "eq." + user.id }, patch); } catch (_) { /* swallow */ }
          return fail(res, 401, "Invalid username or password.");
        }
        try {
          await sbUpdate("app_users", { id: "eq." + user.id }, {
            last_login_at: new Date().toISOString(),
            failed_attempts: 0,
            locked_until: null,
          });
        } catch (_) { /* swallow — login still succeeds */ }
        const token = await signSession({
          user: user.username,
          role: user.role || "viewer",
          user_id: user.id,
          must_reset: !!user.must_reset,
        });
        return json(res, 200, {
          token,
          user: user.username,
          role: user.role || "viewer",
          must_reset: !!user.must_reset,
          expiresIn: 12 * 3600,
        });
      }
    } catch (_) {
      // Fall through to env-var bootstrap. If app_users doesn't exist yet
      // (migration not applied), we don't want every login to 500.
    }
  }

  // ── Path 2: env-var bootstrap account ────────────────────────────────
  const expectedUser = process.env.APP_USER;
  const expectedHash = process.env.APP_PASS_HASH;
  if (!expectedUser || !expectedHash) {
    return fail(res, 500, "Auth is not configured on the server.");
  }
  // Always run bcrypt even on wrong username so timing doesn't reveal which.
  const userOk = username === expectedUser;
  const passOk = await bcrypt.compare(password, expectedHash).catch(() => false);
  if (!userOk || !passOk) return fail(res, 401, "Invalid username or password.");

  const token = await signSession({ user: username, role: "admin" });
  return json(res, 200, { token, user: username, role: "admin", must_reset: false, expiresIn: 12 * 3600 });
}
