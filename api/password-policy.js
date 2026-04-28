// /api/password-policy
//
// GET   — returns the current policy. Any authenticated session can read it
//         so the New CSM modal, App Users tab, and forgot-password flow can
//         all show the live requirements.
// PATCH — admin only. Updates one or more fields and invalidates the
//         server-side cache. Writes an audit_log row.

import { hardenResponse, fail, failUpstream, json, rateLimit } from "./_lib/security.js";
import { requireAuth, requireRole } from "./_lib/auth.js";
import { sbConfigured, sbUpdate, sbInsert } from "./_lib/sb.js";
import { writeAudit } from "./_lib/supabase.js";
import { loadPolicy, invalidatePolicy } from "./_lib/password.js";

const FIELDS = ["min_length", "require_upper", "require_lower", "require_number", "require_symbol"];

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rl = rateLimit(req, "password-policy");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method === "GET") {
    try {
      const policy = await loadPolicy();
      return json(res, 200, { policy });
    } catch (e) { return failUpstream(res, session, 502, "Failed to read policy.", e); }
  }

  if (req.method === "PATCH") {
    if (!requireRole(session, "admin", res)) return;
    if (!sbConfigured()) return fail(res, 500, "Supabase not configured.");

    let body = req.body;
    try { if (typeof body === "string") body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON body."); }
    body = body || {};

    const patch = {};
    if (body.min_length != null) {
      const n = Number(body.min_length);
      if (!Number.isInteger(n) || n < 8 || n > 128) return fail(res, 400, "min_length must be an integer between 8 and 128.");
      patch.min_length = n;
    }
    for (const k of ["require_upper", "require_lower", "require_number", "require_symbol"]) {
      if (body[k] != null) patch[k] = !!body[k];
    }
    if (!Object.keys(patch).length) return fail(res, 400, "No fields to update.");
    patch.updated_by = String(session.user || "unknown").slice(0, 200);

    const before = await loadPolicy();
    try {
      // The single-row table uses id=1; upsert handles a fresh DB where
      // the seed insert hasn't happened yet (e.g. running migration 009
      // out of order during local dev).
      let updated = await sbUpdate("password_policy", { id: "eq.1" }, patch);
      if (!Array.isArray(updated) || !updated.length) {
        updated = await sbInsert("password_policy", [{ id: 1, ...patch }]);
      }
      invalidatePolicy();
      const row = Array.isArray(updated) ? updated[0] : updated;
      const after = {};
      for (const k of FIELDS) after[k] = row?.[k] ?? before[k];
      await writeAudit({
        actor:        String(session.user || "unknown"),
        actor_role:   String(session.role || "user"),
        action:       "password_policy.update",
        target_table: "password_policy",
        target_id:    "1",
        before_state: before,
        after_state:  after,
        metadata:     { fields: Object.keys(patch).filter(k => k !== "updated_by") },
      });
      return json(res, 200, { policy: after });
    } catch (e) {
      const msg = String(e.message || "");
      // PostgREST returns 404 with code 42P01 when the table doesn't exist —
      // tell the admin exactly which migration they're missing rather than
      // just bubbling the raw Postgres error up.
      if (msg.includes("42P01") || /relation .*password_policy.* does not exist/i.test(msg)) {
        return fail(res, 503, "Password policy table is missing. Apply migration 009_password_policy.sql in Supabase, then try again.");
      }
      return fail(res, 502, "Failed to update policy.", { detail: msg });
    }
  }

  return fail(res, 405, "Method not allowed.");
}
