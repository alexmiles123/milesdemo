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

  // Resolve the table path. Try req.query.path first (the documented
  // Vercel catch-all behavior); fall back to parsing req.url. Both paths
  // have been observed to fail in isolation across Vercel runtime versions,
  // so we try both and reject if neither works.
  let pathParts = [];
  const qp = req.query?.path;
  if (Array.isArray(qp) && qp.length) pathParts = qp;
  else if (typeof qp === "string" && qp) pathParts = qp.split("/").filter(Boolean);
  if (!pathParts.length) {
    const urlNoQs = (req.url || "").split("?")[0];
    const afterPrefix = urlNoQs.replace(/^\/api\/db\/?/, "");
    pathParts = afterPrefix.split("/").filter(Boolean);
  }
  // Guard against Vercel ever echoing the literal route param `[...path]`.
  pathParts = pathParts.filter(p => !/^\[.*\]$/.test(p));
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

  // Rebuild the query string from req.query, skipping the `path` key that
  // Vercel's catch-all injects. Forwarding it unfiltered was causing
  // PostgREST to see `path=csms` alongside the real filters and fail with
  // a "failed to parse tree path" error.
  const forwardParams = new URLSearchParams();
  if (req.query && typeof req.query === "object") {
    for (const [k, v] of Object.entries(req.query)) {
      if (k === "path") continue;
      if (Array.isArray(v)) v.forEach(val => forwardParams.append(k, val));
      else if (v != null) forwardParams.append(k, v);
    }
  }
  const qs = forwardParams.toString();

  // Path under rest/v1 — allow sub-paths (e.g. /rpc/some_fn) if we ever add them.
  const subPath = pathParts.join("/");
  const target = `${sbUrl}/rest/v1/${subPath}${qs ? "?" + qs : ""}`;

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
