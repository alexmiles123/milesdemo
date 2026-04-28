// Shared security primitives for every API route.
//
// The goal is to give Monument a posture that passes SOC 2 CC6 / CC7 / CC8
// basics without adding dependencies:
//   • timing-safe HMAC signature verification for inbound webhooks
//   • per-IP token-bucket rate limit (in-memory — degrades at scale but is
//     defensible for a single Vercel region, and the limit is bypassable
//     only by attackers who can already flood your ingress)
//   • request ID tagging so audit rows tie back to a single HTTP call
//   • an allowlist of response headers that sets sensible defaults (CORS,
//     referrer policy, content-type, cache control, HSTS)
//   • redactSecrets() so we never accidentally echo a bearer token back
//     to a caller or write one into the audit log
//
// Never import this module from code that ships to the browser.

import crypto from "node:crypto";

// ─── Rate limit ─────────────────────────────────────────────────────────────
//
// Two-tier limiter:
//   • Upstash Redis (production): globally consistent across Vercel regions.
//     Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
//   • In-memory token bucket (dev / Upstash outage): per-instance, so a
//     determined attacker hitting multiple regions can outpace it. Still
//     defensible for a single-region deploy and prevents accidental DoS.
//
// rateLimit() is async — callers must `await`. The function never throws;
// an Upstash failure silently degrades to the memory bucket.

const BUCKETS = new Map();
const BUCKET_CAP = 60;
const BUCKET_REFILL_PER_MIN = 60;

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const UPSTASH_ENABLED = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
const UPSTASH_WINDOW_SEC = 60;

function clientIp(req) {
  const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

function bucketKey(req, scope) {
  return scope + ":" + clientIp(req);
}

function memoryRateLimit(req, scope, cost) {
  const key = bucketKey(req, scope);
  const now = Date.now();
  const existing = BUCKETS.get(key) || { tokens: BUCKET_CAP, ts: now };
  const elapsedMin = (now - existing.ts) / 60_000;
  const refilled = Math.min(BUCKET_CAP, existing.tokens + elapsedMin * BUCKET_REFILL_PER_MIN);
  if (refilled < cost) {
    const retrySec = Math.ceil((cost - refilled) * 60 / BUCKET_REFILL_PER_MIN);
    BUCKETS.set(key, { tokens: refilled, ts: now });
    return { ok: false, retryAfter: retrySec };
  }
  BUCKETS.set(key, { tokens: refilled - cost, ts: now });
  if (BUCKETS.size > 2000) {
    const cutoff = now - 10 * 60_000;
    for (const [k, v] of BUCKETS) if (v.ts < cutoff) BUCKETS.delete(k);
  }
  return { ok: true };
}

async function upstashRateLimit(req, scope, cost) {
  const key = "rl:" + bucketKey(req, scope);
  // INCRBY n + EXPIRE NX in one round-trip. INCRBY returns the new counter
  // value; if it's the first hit in the window, EXPIRE NX sets the TTL.
  const body = [
    ["INCRBY", key, String(cost)],
    ["EXPIRE", key, String(UPSTASH_WINDOW_SEC), "NX"],
  ];
  const r = await fetch(UPSTASH_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + UPSTASH_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  const data = await r.json();
  const n = Number(data?.[0]?.result || 0);
  if (n > BUCKET_CAP) return { ok: false, retryAfter: UPSTASH_WINDOW_SEC };
  return { ok: true };
}

export async function rateLimit(req, scope = "default", cost = 1) {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashRateLimit(req, scope, cost);
    } catch (_) {
      // Fall through to memory limiter — never throw from a rate-limit check.
    }
  }
  return memoryRateLimit(req, scope, cost);
}

// ─── Default response hardening ─────────────────────────────────────────────
export function hardenResponse(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin || "";
  const appUrl = process.env.APP_URL || "";
  if (appUrl && origin === appUrl) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-CSRF-Token, Prefer");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

// ─── Request ID ─────────────────────────────────────────────────────────────
export function requestId(req) {
  const incoming = req.headers["x-request-id"];
  if (incoming && /^[\w-]{1,64}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

// ─── HMAC verification ──────────────────────────────────────────────────────
// Expects a header like "sha256=<hex>". Timing-safe compare. Returns true iff
// the secret is configured AND the signature matches the raw request body.
// If no secret is configured, returns false so the caller can 401.
export function verifyHmac(rawBody, headerValue, secret) {
  if (!secret || !headerValue) return false;
  const provided = String(headerValue).replace(/^sha256=/, "");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}

// Read the raw request body as a string so HMAC can be computed from the
// exact bytes the sender signed. Vercel parses JSON by default, which would
// reorder keys / re-emit whitespace and break the signature.
export async function readRawBody(req) {
  if (req.rawBody) return req.rawBody; // some runtimes populate this
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ─── Secret redaction ───────────────────────────────────────────────────────
// Recursively replace anything that smells like a secret before returning
// a payload to a caller or writing it into audit_log.
const SECRET_KEY_RE = /(secret|token|password|bearer|apikey|api_key|private_key|authorization|credential)/i;

export function redactSecrets(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^(bearer |eyj|sk-|xox[ab]-)/i.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ─── Thin wrapper for JSON responses ────────────────────────────────────────
export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// ─── Error handler: never leak stack traces in responses ───────────────────
export function fail(res, status, message, extra = {}) {
  const safe = typeof message === "string" ? message : "Internal error.";
  json(res, status, { error: safe, ...extra });
}

// Wrap upstream/database errors. Admins see the full constraint name and
// PostgREST detail (so they can debug from the UI); everyone else sees a
// generic friendly message. The full error is always logged server-side
// regardless of role so ops keeps observability.
export function failUpstream(res, session, status, friendly, error) {
  const detail = error && error.message ? String(error.message) : "";
  // Server-side log — keep the noisy stuff out of the response but in logs.
  try { console.error("[upstream]", status, friendly, detail); } catch { /* ignore */ }
  const isAdmin = session && session.role === "admin";
  if (isAdmin && detail) {
    return fail(res, status, friendly, { detail });
  }
  return fail(res, status, friendly);
}
