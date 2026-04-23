// JWT session helpers.
//
// Server-side validation for the Monument app. The browser POSTs credentials
// to /api/auth/login, gets back a signed JWT, and sends it as
//   Authorization: Bearer <token>
// on every subsequent API call. Any endpoint that calls requireAuth() will
// 401 unless the token is present, signed by APP_JWT_SECRET, and unexpired.
//
// Never import this module from browser code.

import { SignJWT, jwtVerify } from "jose";
import { fail } from "./security.js";

const ALG = "HS256";
const TTL_HOURS = 12;

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.APP_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APP_JWT_SECRET must be set and at least 32 characters.");
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function signSession({ user, role = "user" }) {
  return await new SignJWT({ user, role })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .setIssuer("monument")
    .setAudience("monument-app")
    .sign(getKey());
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: "monument",
      audience: "monument-app",
    });
    return payload;
  } catch {
    return null;
  }
}

// Extract and verify the bearer token. Returns the session payload or
// sends a 401 response and returns null. Callers short-circuit on null.
export async function requireAuth(req, res) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) { fail(res, 401, "Missing bearer token."); return null; }
  const session = await verifySession(m[1].trim());
  if (!session) { fail(res, 401, "Invalid or expired session."); return null; }
  return session;
}
