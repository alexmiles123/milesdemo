// POST /api/auth/logout
// Clears all three session cookies. Idempotent — never returns 401 even if
// the cookies are already missing or invalid.

import { hardenResponse, fail, json } from "../_lib/security.js";
import { clearSessionCookies } from "../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  clearSessionCookies(res);
  return json(res, 200, { ok: true });
}
