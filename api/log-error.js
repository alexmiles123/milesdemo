// POST /api/log-error
// Body: { message, stack?, component_stack?, url?, ts? }
//
// Best-effort sink for client-side errors caught by ErrorBoundary. Writes
// one row to audit_log with action="client.error" so admins can see render
// failures alongside everything else. We deliberately accept anonymous
// posts here — a render error often means the user's session is broken,
// and we still want the breadcrumb. The route is rate-limited per IP.

import { hardenResponse, fail, json, rateLimit, redactSecrets } from "./_lib/security.js";
import { sbInsert, sbConfigured } from "./_lib/sb.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "log-error", 1);
  if (!rl.ok) return json(res, 200, { ok: true });

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { return json(res, 200, { ok: true }); }
  body = body || {};

  if (!sbConfigured()) return json(res, 200, { ok: true });

  const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || req.socket?.remoteAddress || "unknown";
  const ua = (req.headers["user-agent"] || "").toString().slice(0, 256);
  const metadata = redactSecrets({
    message: (body.message || "").toString().slice(0, 1000),
    stack: (body.stack || "").toString().slice(0, 4000),
    component_stack: (body.component_stack || "").toString().slice(0, 4000),
    url: (body.url || "").toString().slice(0, 500),
    client_ts: body.ts || null,
    ip, ua,
  });

  try {
    await sbInsert("audit_log", {
      actor: "client",
      action: "client.error",
      entity_type: "session",
      entity_id: null,
      metadata,
    }, "return=minimal");
  } catch (_) { /* never propagate */ }

  return json(res, 200, { ok: true });
}
