// GET /api/auth/me
// Returns the current session payload — user, role, must_reset.
// The frontend uses this to populate UI gating (role-based tab visibility,
// "Signed in as alex") because the access JWT now lives in an HttpOnly
// cookie that JavaScript cannot read.

import { hardenResponse, fail, json } from "../_lib/security.js";
import { requireAuth } from "../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "GET") return fail(res, 405, "Method not allowed.");

  const session = await requireAuth(req, res);
  if (!session) return;

  return json(res, 200, {
    user: session.user,
    role: session.role,
    user_id: session.user_id || null,
    must_reset: !!session.must_reset,
  });
}
