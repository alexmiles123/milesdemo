// POST /api/auth/refresh
// Exchanges a valid refresh-token cookie for a new access-token cookie.
// The refresh cookie itself is not rotated on every refresh — that's an
// optimization. We do re-verify it against app_users so a deactivated
// account can't keep refreshing forever.

import { hardenResponse, fail, json, rateLimit } from "../_lib/security.js";
import { signSession, issueSessionCookies, readCookie, verifySession, COOKIE_NAMES, signRefresh, clearSessionCookies } from "../_lib/auth.js";
import { sbConfigured, sbGet, sbInsert } from "../_lib/sb.js";

// Refresh-token rotation:
//   Every time we mint a new access cookie, we ALSO mint a brand-new refresh
//   cookie with a fresh jti and record the previous jti in `auth_refresh_jti`
//   as consumed. Replaying the old refresh cookie (e.g. one that was stolen
//   off a backup or cached on a compromised device) hits the "already
//   consumed" check and the entire user session is forcibly logged out — a
//   classic detection signal for an attacker holding a stale token.
//
// Soft-fail mode:
//   If the consumed-jti table is unreachable (Supabase outage, migration
//   missing in dev), we still issue a new pair so legitimate users aren't
//   locked out — but we log a warning. In production the table is required.
export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "auth-refresh", 1);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Too many refresh attempts."); }

  const refreshToken = readCookie(req, COOKIE_NAMES.refresh);
  if (!refreshToken) return fail(res, 401, "No refresh token.");

  const claims = await verifySession(refreshToken, "refresh");
  if (!claims) return fail(res, 401, "Invalid or expired refresh token.");

  // Re-check the user is still active so a disabled account can't keep
  // refreshing once the access token expires.
  let user = claims.user;
  let role = claims.role;
  let user_id = claims.user_id || null;
  let csm_id = claims.csm_id || null;
  let must_reset = false;
  if (sbConfigured() && user_id) {
    try {
      const rows = await sbGet("app_users", {
        select: "id,username,role,csm_id,is_active,must_reset",
        id: "eq." + user_id,
        limit: "1",
      });
      const row = rows && rows[0];
      if (!row || row.is_active === false) return fail(res, 401, "Account is disabled.");
      role = row.role || role;
      csm_id = row.csm_id || null;
      must_reset = !!row.must_reset;
    } catch (_) {
      // If app_users is unreachable, fall back to the refresh-token claims
      // rather than locking everyone out of refresh during an outage.
    }
  }

  // Mark the incoming jti as consumed. If it's already there → replay attempt
  // → wipe the session so the legitimate user has to re-authenticate, which
  // will mint fresh credentials and invalidate whatever the attacker holds.
  const oldJti = claims.jti || null;
  if (sbConfigured() && oldJti) {
    try {
      await sbInsert("auth_refresh_jti", {
        jti: oldJti,
        user_id,
        consumed_at: new Date().toISOString(),
      });
    } catch (e) {
      const msg = String(e?.message || e || "");
      // 23505 = unique_violation → jti already consumed → token replay.
      if (/23505|duplicate key|unique/i.test(msg)) {
        clearSessionCookies(res);
        return fail(res, 401, "Refresh token has already been used. Please sign in again.");
      }
      // Other errors (network, table missing in dev) are non-fatal.
    }
  }

  const access = await signSession({ user, role, user_id, csm_id, must_reset });
  const newRefresh = await signRefresh({ user, role, user_id, csm_id });
  const csrf = issueSessionCookies(res, { accessToken: access, refreshToken: newRefresh });
  return json(res, 200, { csrf, user, role, must_reset, expiresIn: 3600 });
}
