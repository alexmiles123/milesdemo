// Rate limit adapter: Upstash Redis in production, in-memory fallback in dev.
//
// The in-memory limiter in security.js is region-scoped — a single Vercel
// lambda instance owns the bucket, so an attacker can burst past the limit
// by hitting multiple regions. For real production, point the app at Upstash
// (or Vercel KV, which speaks the same REST API) and the limiter becomes
// globally consistent.
//
// Upstash REST endpoint + token are in env:
//   UPSTASH_REDIS_REST_URL   e.g. https://apn1-xxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN the REST token (NOT the TCP password)
//
// If either env var is missing we silently fall back to the in-memory bucket.
// Do NOT throw — we don't want an Upstash outage to take down the API.

import { rateLimit as memoryRateLimit } from "./security.js";

const URL   = process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const ENABLED = !!(URL && TOKEN);

const CAP_PER_MIN = 60;   // requests / IP / minute
const WINDOW_SEC  = 60;

function keyFor(req, scope) {
  const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip  = fwd || req.socket?.remoteAddress || "unknown";
  return `rl:${scope}:${ip}`;
}

// Upstash REST pipeline: INCR the window key, set TTL on first hit.
// One round-trip via the /pipeline endpoint.
async function upstashIncr(key) {
  const body = [["INCR", key], ["EXPIRE", key, String(WINDOW_SEC), "NX"]];
  const res = await fetch(URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("upstash " + res.status);
  const [incrResult] = await res.json();
  return Number(incrResult.result || 0);
}

export async function rateLimit(req, scope = "default") {
  if (!ENABLED) return memoryRateLimit(req, scope);
  try {
    const n = await upstashIncr(keyFor(req, scope));
    if (n > CAP_PER_MIN) {
      return { ok: false, retryAfter: WINDOW_SEC, remaining: 0 };
    }
    return { ok: true, remaining: CAP_PER_MIN - n };
  } catch {
    // Upstash unreachable → do NOT fail open catastrophically; use memory
    // limiter which at least blocks per-region bursts.
    return memoryRateLimit(req, scope);
  }
}
