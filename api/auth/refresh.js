// POST /api/auth/refresh
// Exchanges a valid refresh-token cookie for a new access-token cookie.
// The refresh cookie itself is not rotated on every refresh — that's an
// optimization. We do re-verify it against app_users so a deactivated
// account can't keep refreshing forever.

import { hardenResponse, fail, json, rateLimit } from "../_lib/security.js";
import { signSession, issueSessionCookies, readCookie, verifySession, COOKIE_NAMES, signRefresh } from "../_lib/auth.js";
import { sbConfigured, sbGet } from "../_lib/sb.js";

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
  let must_reset = false;
  if (sbConfigured() && user_id) {
    try {
      const rows = await sbGet("app_users", {
        select: "id,username,role,is_active,must_reset",
        id: "eq." + user_id,
        limit: "1",
      });
      const row = rows && rows[0];
      if (!row || row.is_active === false) return fail(res, 401, "Account is disabled.");
      role = row.role || role;
      must_reset = !!row.must_reset;
    } catch (_) {
      // If app_users is unreachable, fall back to the refresh-token claims
      // rather than locking everyone out of refresh during an outage.
    }
  }

  const access = await signSession({ user, role, user_id, must_reset });
  const newRefresh = await signRefresh({ user, role, user_id });
  const csrf = issueSessionCookies(res, { accessToken: access, refreshToken: newRefresh });
  return json(res, 200, { csrf, user, role, must_reset, expiresIn: 3600 });
}
