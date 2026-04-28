// /api/admin/users — admin-only CRUD over app_users.
//
// Why this lives outside /api/db:
//   • password_hash must never be returned to the browser; the proxy returns
//     full rows, so it can't safely host this.
//   • We want to enforce role checks (admin only) and run bcrypt server-side.
//
// Methods:
//   GET    list users (no password_hash)
//   POST   create   { username, email, full_name?, role, password }
//   PATCH  update   { id, ...partial }
//                   - if `password` provided, it's hashed and password_hash
//                     replaced; the patch field itself is dropped.
//                   - if `is_active` is set to true, locked_until and
//                     failed_attempts are cleared.
//   DELETE soft-delete via { id }   (sets is_active=false; we never hard-
//          delete to preserve audit trails)
//
// Every mutation also writes to audit_log with the actor's user_id.

import bcrypt from "bcryptjs";
import { hardenResponse, fail, json, rateLimit } from "../_lib/security.js";

// 12 rounds — ~250ms on commodity hardware. 10 was the bcryptjs default but
// is now considered borderline against modern GPU rigs; 12 quadruples the
// per-guess cost without making interactive sign-up feel slow.
const BCRYPT_ROUNDS = 12;
import { requireAuth, requireRole } from "../_lib/auth.js";
import { sbGet, sbInsert, sbUpdate, sbConfigured } from "../_lib/sb.js";
import { validatePassword } from "../_lib/password.js";
import { isValidRoleName } from "../_lib/roles.js";

const PUBLIC_FIELDS = "id,username,email,full_name,role,is_active,must_reset,last_login_at,failed_attempts,locked_until,created_at,updated_at";

async function audit(actor, action, entityId, metadata) {
  try {
    await sbInsert("audit_log", {
      actor: actor || "unknown",
      action,
      entity_type: "app_user",
      entity_id: entityId,
      metadata: metadata || {},
    }, "return=minimal");
  } catch (_) { /* never let audit failures block the operation */ }
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rl = await rateLimit(req, "admin-users");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  if (!sbConfigured()) return fail(res, 500, "Supabase not configured.");

  const session = await requireAuth(req, res);
  if (!session) return;
  if (!requireRole(session, "admin", res)) return;

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON body."); }
  body = body || {};

  if (req.method === "GET") {
    try {
      const rows = await sbGet("app_users", { select: PUBLIC_FIELDS, order: "username.asc" });
      return json(res, 200, { users: rows || [] });
    } catch (e) { return fail(res, 502, "Failed to list users.", { detail: e.message }); }
  }

  if (req.method === "POST") {
    const username = (body.username || "").toString().trim();
    const email    = (body.email || "").toString().trim().toLowerCase();
    const fullName = (body.full_name || "").toString().trim() || null;
    const role     = (body.role || "viewer").toString();
    const password = (body.password || "").toString();
    if (!username || !email) return fail(res, 400, "Username and email are required.");
    if (!(await isValidRoleName(role))) return fail(res, 400, "Invalid role.");
    const pwErr = await validatePassword(password);
    if (pwErr) return fail(res, 400, pwErr);

    try {
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const inserted = await sbInsert("app_users", [{
        username, email, full_name: fullName, password_hash: hash, role, is_active: true, must_reset: !!body.must_reset,
      }]);
      const created = Array.isArray(inserted) ? inserted[0] : inserted;
      const safe = created ? { ...created, password_hash: undefined } : null;
      await audit(session.user, "user.create", created?.id, { username, email, role });
      return json(res, 201, { user: safe });
    } catch (e) {
      const msg = e.message?.includes("duplicate") ? "Username or email already exists." : "Failed to create user.";
      return fail(res, 400, msg);
    }
  }

  if (req.method === "PATCH") {
    const id = (body.id || "").toString();
    if (!id) return fail(res, 400, "id is required.");
    const patch = {};
    if (body.email != null)      patch.email     = body.email.toString().trim().toLowerCase();
    if (body.full_name != null)  patch.full_name = body.full_name.toString().trim() || null;
    if (body.role != null) {
      if (!(await isValidRoleName(body.role))) return fail(res, 400, "Invalid role.");
      patch.role = body.role;
    }
    if (body.is_active != null) {
      patch.is_active = !!body.is_active;
      if (patch.is_active) { patch.locked_until = null; patch.failed_attempts = 0; }
    }
    if (body.must_reset != null) patch.must_reset = !!body.must_reset;
    if (typeof body.password === "string" && body.password.length > 0) {
      const pwErr = await validatePassword(body.password);
      if (pwErr) return fail(res, 400, pwErr);
      patch.password_hash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      patch.must_reset = !!body.must_reset; // admin can require re-set on next login
      patch.failed_attempts = 0;
      patch.locked_until = null;
    }
    if (!Object.keys(patch).length) return fail(res, 400, "No fields to update.");

    // Don't let an admin demote/disable themselves into a no-admin state.
    if (id === session.user_id && (patch.role && patch.role !== "admin")) {
      return fail(res, 400, "You cannot remove admin role from your own account.");
    }
    if (id === session.user_id && patch.is_active === false) {
      return fail(res, 400, "You cannot disable your own account.");
    }

    try {
      const updated = await sbUpdate("app_users", { id: "eq." + id }, patch);
      const row = Array.isArray(updated) ? updated[0] : updated;
      const safe = row ? { ...row, password_hash: undefined } : null;
      await audit(session.user, "user.update", id, { fields: Object.keys(patch) });
      return json(res, 200, { user: safe });
    } catch (e) { return fail(res, 502, "Failed to update user.", { detail: e.message }); }
  }

  if (req.method === "DELETE") {
    const id = (body.id || "").toString();
    if (!id) return fail(res, 400, "id is required.");
    if (id === session.user_id) return fail(res, 400, "You cannot disable your own account.");
    try {
      await sbUpdate("app_users", { id: "eq." + id }, { is_active: false });
      await audit(session.user, "user.disable", id, {});
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, 502, "Failed to disable user.", { detail: e.message }); }
  }

  return fail(res, 405, "Method not allowed.");
}
