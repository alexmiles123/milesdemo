// JWT session helpers + cookie / CSRF management.
//
// The browser used to ship the access JWT in localStorage and send it as a
// bearer header. That's an XSS-readable secret — any third-party script that
// lands in the bundle can exfiltrate every session. We now keep the JWT in
// an HttpOnly + Secure + SameSite=Strict cookie that JavaScript cannot read.
//
// Three cookies, all signed by APP_JWT_SECRET:
//   monument.session    — short-lived access JWT (1h). HttpOnly.
//   monument.refresh    — long-lived refresh JWT (30d). HttpOnly. Used by
//                         /api/auth/refresh to mint a new access token.
//   monument.csrf       — random token. NOT HttpOnly. The browser echoes its
//                         value back on every state-changing request via the
//                         X-CSRF-Token header (double-submit pattern). Cookie
//                         auth is automatically attached by the browser, so
//                         without this echo any cross-origin POST a victim
//                         loads would inherit their session — classic CSRF.
//
// requireAuth() accepts either the access cookie OR a legacy bearer header,
// so existing tabs with the old localStorage token keep working until they
// re-authenticate.
//
// Never import this module from browser code.

import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { fail } from "./security.js";

const ALG = "HS256";
const ACCESS_TTL_HOURS  = 1;
const REFRESH_TTL_DAYS  = 30;

const COOKIE_ACCESS  = "monument.session";
const COOKIE_REFRESH = "monument.refresh";
const COOKIE_CSRF    = "monument.csrf";

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

export async function signSession({ user, role = "user", user_id = null, csm_id = null, must_reset = false }) {
  const payload = { user, role, typ: "access" };
  if (user_id) payload.user_id = user_id;
  if (csm_id)  payload.csm_id  = csm_id;
  if (must_reset) payload.must_reset = true;
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_HOURS}h`)
    .setIssuer("monument")
    .setAudience("monument-app")
    .sign(getKey());
}

// Refresh tokens carry a unique jti so a stolen cookie can't be replayed
// after the legitimate user refreshes — /api/auth/refresh records each jti
// it has consumed and rejects any token whose jti has been seen before.
export async function signRefresh({ user, role, user_id = null, csm_id = null, jti = null }) {
  const payload = { user, role, typ: "refresh" };
  if (user_id) payload.user_id = user_id;
  if (csm_id)  payload.csm_id  = csm_id;
  const tokenId = jti || crypto.randomBytes(16).toString("hex");
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setJti(tokenId)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_DAYS}d`)
    .setIssuer("monument")
    .setAudience("monument-app")
    .sign(getKey());
}

export function requireRole(session, role, res) {
  if (!session || session.role !== role) {
    fail(res, 403, "Insufficient permissions.");
    return false;
  }
  return true;
}

export async function verifySession(token, expectedTyp = "access") {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: "monument",
      audience: "monument-app",
    });
    if (expectedTyp && payload.typ && payload.typ !== expectedTyp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ────────────────────────────────────────────────────────

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readCookie(req, name) {
  return parseCookies(req)[name] || null;
}

function buildCookie(name, value, { maxAge, httpOnly = true, sameSite = "Strict", path = "/" } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  parts.push("Secure");
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function appendSetCookie(res, value) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", value);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", existing.concat(value));
  } else {
    res.setHeader("Set-Cookie", [existing, value]);
  }
}

export function issueSessionCookies(res, { accessToken, refreshToken }) {
  const csrf = crypto.randomBytes(32).toString("hex");
  const accessAge  = ACCESS_TTL_HOURS * 3600;
  const refreshAge = REFRESH_TTL_DAYS * 24 * 3600;
  appendSetCookie(res, buildCookie(COOKIE_ACCESS,  accessToken,  { maxAge: accessAge,  httpOnly: true }));
  if (refreshToken) {
    appendSetCookie(res, buildCookie(COOKIE_REFRESH, refreshToken, { maxAge: refreshAge, httpOnly: true, path: "/api/auth" }));
  }
  // CSRF is intentionally NOT HttpOnly so the SPA can read it and echo it
  // as a header on writes. The double-submit check requires both pieces.
  appendSetCookie(res, buildCookie(COOKIE_CSRF, csrf, { maxAge: accessAge, httpOnly: false }));
  return csrf;
}

export function clearSessionCookies(res) {
  appendSetCookie(res, buildCookie(COOKIE_ACCESS,  "", { maxAge: 0, httpOnly: true }));
  appendSetCookie(res, buildCookie(COOKIE_REFRESH, "", { maxAge: 0, httpOnly: true, path: "/api/auth" }));
  appendSetCookie(res, buildCookie(COOKIE_CSRF,    "", { maxAge: 0, httpOnly: false }));
}

// ─── CSRF ──────────────────────────────────────────────────────────────────

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function checkCsrf(req) {
  if (CSRF_SAFE_METHODS.has(req.method)) return true;
  // Only enforce when the caller is using cookie auth. Bearer-token clients
  // (legacy, or first-party server-to-server) prove possession of the JWT
  // directly, which CSRF can't forge.
  const cookieToken = readCookie(req, COOKIE_ACCESS);
  if (!cookieToken) return true;
  const csrfCookie = readCookie(req, COOKIE_CSRF);
  const csrfHeader = req.headers["x-csrf-token"] || "";
  if (!csrfCookie || !csrfHeader) return false;
  if (csrfCookie.length !== csrfHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader));
  } catch {
    return false;
  }
}

// ─── requireAuth ───────────────────────────────────────────────────────────

export async function requireAuth(req, res) {
  // 1. Prefer the HttpOnly access cookie.
  const cookieToken = readCookie(req, COOKIE_ACCESS);
  let token = cookieToken;
  // 2. Legacy bearer header (in-flight tabs and server-to-server callers).
  if (!token) {
    const auth = req.headers.authorization || req.headers.Authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) token = m[1].trim();
  }
  if (!token) { fail(res, 401, "Authentication required."); return null; }

  const session = await verifySession(token, "access");
  if (!session) { fail(res, 401, "Invalid or expired session."); return null; }

  // CSRF check applies to cookie-authed writes only.
  if (cookieToken && !checkCsrf(req)) {
    fail(res, 403, "CSRF check failed.");
    return null;
  }
  return session;
}

export const COOKIE_NAMES = {
  access:  COOKIE_ACCESS,
  refresh: COOKIE_REFRESH,
  csrf:    COOKIE_CSRF,
};
