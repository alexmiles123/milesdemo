// POST /api/auth/login
// Body: { username, password }
// On success: { token, user, expiresIn }
//
// Credentials live in env vars so they never reach the browser bundle:
//   APP_USER          — the single allowed username
//   APP_PASS_HASH     — bcryptjs hash of the password
//   APP_JWT_SECRET    — 32+ char secret used to sign session JWTs

import bcrypt from "bcryptjs";
import { rateLimit, hardenResponse, fail, json } from "../_lib/security.js";
import { signSession } from "../_lib/auth.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "auth-login", 5);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Too many login attempts."); }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch { return fail(res, 400, "Invalid JSON body."); }

  const username = (body?.username || "").toString().trim();
  const password = (body?.password || "").toString();
  if (!username || !password) return fail(res, 400, "Username and password are required.");

  const expectedUser = process.env.APP_USER;
  const expectedHash = process.env.APP_PASS_HASH;
  if (!expectedUser || !expectedHash) {
    return fail(res, 500, "Auth is not configured on the server.");
  }

  // Always run bcrypt even on wrong username so response times don't
  // leak whether the username exists.
  const userOk = username === expectedUser;
  const passOk = await bcrypt.compare(password, expectedHash).catch(() => false);
  if (!userOk || !passOk) return fail(res, 401, "Invalid username or password.");

  const token = await signSession({ user: username, role: "admin" });
  return json(res, 200, { token, user: username, expiresIn: 12 * 3600 });
}
