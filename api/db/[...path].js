// Authenticated Supabase REST proxy.
//
// The frontend no longer talks to Supabase directly — it calls
//   /api/db/<table>?query...
// with Authorization: Bearer <jwt>. This handler verifies the JWT, then
// forwards the exact same request to SUPABASE_URL/rest/v1/<table> using
// the service key (which never reaches the browser).
//
// Why this matters: the previous architecture shipped the anon key in the
// React bundle and used USING(true) RLS policies, meaning anyone who
// loaded the site could read/write every table. This proxy makes the
// anon key obsolete and gates every DB call on a signed session.

import { hardenResponse, fail, rateLimit } from "../_lib/security.js";
import { requireAuth } from "../_lib/auth.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE", "PUT"]);

// Tables the frontend is allowed to touch. Anything outside this set 404s.
// The cron/webhook paths hit Supabase directly with the service key, not
// through this proxy, so admin-only tables (audit_log writes, etc.) don't
// need to appear here.
const ALLOWED_TABLES = new Set([
  "csms", "csm_roles", "csm_assignments",
  "projects", "tasks",
  "capacity_entries", "project_commitments",
  "customers", "customer_interactions",
  "integrations", "sync_runs",
  "notification_rules",
  "audit_log",
]);

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (!ALLOWED_METHODS.has(req.method)) return fail(res, 405, "Method not allowed.");

  const rl = rateLimit(req, "db-proxy");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  // Parse the path segment(s) directly from req.url. Relying on
  // req.query.path is fragile — depending on Vercel's runtime version and
  // how the catch-all route resolves, the dynamic param can come through
  // empty even on a well-formed request.
  const urlNoQs = (req.url || "").split("?")[0];
  const afterPrefix = urlNoQs.replace(/^\/api\/db\/?/, "");
  const pathParts = afterPrefix.split("/").filter(Boolean);
  if (!pathParts.length) return fail(res, 400, "Missing table path.");

  const table = pathParts[0];
  if (!ALLOWED_TABLES.has(table)) return fail(res, 404, "Unknown table.");

  // audit_log is read-only to everyone — writes go through /api/audit which
  // runs its own server-side validation and fixes the actor field.
  if (table === "audit_log" && req.method !== "GET") {
    return fail(res, 403, "audit_log is append-only via /api/audit.");
  }

  const sbUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return fail(res, 500, "Supabase not configured.");

  // Reconstruct query string from the original request.
  const origUrl = req.url || "";
  const qIdx = origUrl.indexOf("?");
  const qs = qIdx >= 0 ? origUrl.slice(qIdx) : "";

  // Path under rest/v1 — allow sub-paths (e.g. /rpc/some_fn) if we ever add them.
  const subPath = pathParts.join("/");
  const target = `${sbUrl}/rest/v1/${subPath}${qs}`;

  const headers = {
    apikey: sbKey,
    Authorization: "Bearer " + sbKey,
    "Content-Type": "application/json",
    Prefer: req.headers["prefer"] || "return=representation",
  };

  let body = undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    return res.end(text);
  } catch (e) {
    return fail(res, 502, "Upstream request failed.", { detail: e.message });
  }
}
