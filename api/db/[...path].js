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

import { hardenResponse, fail, failUpstream, rateLimit, redactSecrets, requestId } from "../_lib/security.js";
import { requireAuth } from "../_lib/auth.js";
import { writeAudit } from "../_lib/supabase.js";
import { validateWrite, checkPayloadSize } from "../_lib/validators.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE", "PUT"]);

// Tables that count as "system configuration" for the audit log. Mutations on
// these are recorded; reads are not (end-user navigation/dashboard views are
// noise). Tables outside this set — e.g. sync_runs telemetry — are skipped to
// keep the audit screen focused on changes a human made.
const AUDIT_TABLES = new Set([
  "csms", "csm_roles", "csm_assignments",
  "projects", "tasks",
  "capacity_entries", "project_commitments",
  "customers", "customer_interactions",
  "integrations",
  "notification_rules",
]);
const AUDIT_VERB = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

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
  // Read-only views the dashboards query. Not listing them here silently
  // returns empty arrays (the frontend catches 404s) — exactly the "all
  // zeros" dashboard bug we hit.
  "vw_portfolio", "vw_csm_scorecard", "vw_integrations_public",
]);

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (!ALLOWED_METHODS.has(req.method)) return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "db-proxy");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  // Parse both the path segments and the query string straight from req.url.
  // Do NOT trust req.query — Vercel's catch-all echoes the route placeholder
  // into it in ways that vary across runtime versions, and the fallout shows
  // up as PostgREST parse errors on the forwarded query.
  const rawUrl = req.url || "";
  const qIdx = rawUrl.indexOf("?");
  const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const rawQs   = qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "";

  let pathParts = rawPath
    .replace(/^\/api\/db\/?/, "")
    .split("/")
    .filter(Boolean)
    .filter(p => !/^[[(].*[\])]$/.test(p)); // drop literal route placeholders
  if (!pathParts.length) return fail(res, 400, "Missing table path.");

  const table = pathParts[0];
  if (!ALLOWED_TABLES.has(table)) return fail(res, 404, "Unknown table.");

  // audit_log carries sensitive operational data (IPs, UAs, before/after
  // state of every config change). Reads are admin-only; writes never go
  // through this proxy — they're produced server-side by /api/audit and
  // the audited() wrapper around mutations.
  if (table === "audit_log") {
    if (req.method !== "GET") {
      return fail(res, 403, "audit_log is append-only via /api/audit.");
    }
    if (session.role !== "admin") {
      return fail(res, 403, "Audit log is admin-only.");
    }
  }

  // Strip anything that could be a Vercel-injected route echo from the
  // forwarded query string. Anything with a dot/bracket/paren in the key
  // is suspect — real PostgREST params use underscores and lowercase.
  const usp = new URLSearchParams(rawQs);
  for (const key of Array.from(usp.keys())) {
    if (key === "path" || /[.[\]()]/.test(key)) usp.delete(key);
  }
  const qs = usp.toString();

  const sbUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return fail(res, 500, "Supabase not configured.");

  // Path under rest/v1 — allow sub-paths (e.g. /rpc/some_fn) if we ever add them.
  const subPath = pathParts.join("/");
  const target = `${sbUrl}/rest/v1/${subPath}${qs ? "?" + qs : ""}`;

  // Opt-in debug mode: set header x-debug-proxy: 1 on the request and the
  // proxy returns its view of the world instead of calling Supabase.
  if (req.headers["x-debug-proxy"] === "1") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      rawUrl, rawPath, rawQs, pathParts, table, qs, target,
      reqQueryKeys: req.query ? Object.keys(req.query) : null,
    }, null, 2));
  }

  const headers = {
    apikey: sbKey,
    Authorization: "Bearer " + sbKey,
    "Content-Type": "application/json",
    Prefer: req.headers["prefer"] || "return=representation",
  };

  let body = undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    // Server-side validation of write payloads. Mirrors src/lib/validation.js
    // but treats client validation as advisory — these checks decide whether
    // the request reaches Supabase at all.
    const sizeCheck = checkPayloadSize(body);
    if (!sizeCheck.ok) return fail(res, 413, sizeCheck.error);
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { return fail(res, 400, "Invalid JSON body."); }
    const v = validateWrite(table, parsed);
    if (!v.ok) return fail(res, 400, v.error);
  }

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    // Audit configuration mutations (POST/PATCH/DELETE on tracked tables).
    // Reads, sync telemetry, and audit_log itself are skipped. Failures here
    // never block the user response — writeAudit() swallows its own errors.
    if (
      req.method !== "GET" &&
      AUDIT_TABLES.has(table) &&
      upstream.status >= 200 && upstream.status < 300
    ) {
      let after = null;
      try { after = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      const afterRow = Array.isArray(after) ? (after[0] ?? null) : after;
      const targetId = afterRow && afterRow.id != null ? String(afterRow.id) : null;
      let reqBody = null;
      try { reqBody = body ? (typeof body === "string" ? JSON.parse(body) : body) : null; } catch { /* noop */ }
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null;
      const ua = String(req.headers["user-agent"] || "").slice(0, 200);
      await writeAudit({
        actor:        String(session.user || "unknown").slice(0, 200),
        actor_role:   String(session.role || "user").slice(0, 200),
        action:       table + "." + (AUDIT_VERB[req.method] || req.method.toLowerCase()),
        target_table: table,
        target_id:    targetId ? targetId.slice(0, 120) : null,
        // For deletes the response body is the row that was removed; for
        // create/update it's the row as it stands after the change.
        before_state: req.method === "DELETE" ? redactSecrets(afterRow) : null,
        after_state:  req.method === "DELETE" ? null : redactSecrets(afterRow),
        ip_address:   ip,
        user_agent:   ua,
        request_id:   requestId(req),
        metadata:     { query: qs || null, request_body: redactSecrets(reqBody) },
      });
    }

    return res.end(text);
  } catch (e) {
    return failUpstream(res, session, 502, "Upstream request failed.", e);
  }
}
