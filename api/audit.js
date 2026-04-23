// POST /api/audit
// Browser → server shim that writes a row into the append-only audit_log.
// The browser cannot write to this table directly (RLS is SELECT-only).
//
// Body: { action, target_table, target_id?, before_state?, after_state?, metadata? }

import { rateLimit, hardenResponse, requestId, fail, json, redactSecrets } from "./_lib/security.js";
import { writeAudit } from "./_lib/supabase.js";
import { requireAuth } from "./_lib/auth.js";

const MAX_STRING = 200;
const MAX_BODY   = 64 * 1024;

function clamp(s) {
  if (s == null) return null;
  const str = String(s);
  return str.length > MAX_STRING ? str.slice(0, MAX_STRING) : str;
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "audit");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);
  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
    if (!body || typeof body !== "object") throw new Error("bad body");
    if (JSON.stringify(body).length > MAX_BODY) return fail(res, 413, "Audit payload too large.");
  } catch { return fail(res, 400, "Invalid JSON body."); }

  if (!body.action || !body.target_table) return fail(res, 400, "action + target_table are required.");

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null;
  const ua = clamp(req.headers["user-agent"]);

  const row = {
    // Identity comes from the verified JWT, not from the client payload —
    // any `actor` in the request body is ignored so a caller can't forge rows
    // as another user.
    actor:        clamp(session.user) || "unknown",
    actor_role:   clamp(session.role) || "user",
    action:       clamp(body.action),
    target_table: clamp(body.target_table),
    target_id:    body.target_id ? String(body.target_id).slice(0, 120) : null,
    before_state: redactSecrets(body.before_state ?? null),
    after_state:  redactSecrets(body.after_state ?? null),
    ip_address:   ip,
    user_agent:   ua,
    request_id:   rid,
    metadata:     redactSecrets(body.metadata ?? {}),
  };

  await writeAudit(row);
  return json(res, 202, { ok: true, request_id: rid });
}
