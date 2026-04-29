// /api/admin/users — admin-only CRUD over app_users.
//
// Why this lives outside /api/db:
//   • password_hash must never be returned to the browser; the proxy returns
//     full rows, so it can't safely host this.
//   • We want to enforce role checks (admin only) and run bcrypt server-side.
//   • Creating a "user" can also create a linked csms row (for users who are
//     also CSMs). Doing both in one request keeps the two tables in sync —
//     the UI never has to remember to provision the login separately.
//
// Methods:
//   GET    list users (no password_hash); each row includes csm_id and the
//          linked csms.{name,role,is_active} fields when present.
//   POST   create   { username, email, full_name?, role, password,
//                     csm_title? }
//                   - if csm_title is provided, inserts a csms row keyed by
//                     email and links app_users.csm_id to it.
//   PATCH  update   { id, ...partial }
//                   - if `password` provided, it's hashed and password_hash
//                     replaced; the patch field itself is dropped.
//                   - if `is_active` is set to true, locked_until and
//                     failed_attempts are cleared.
//                   - if csm_title is provided, the linked csms row's `role`
//                     is updated (or a csms row is created and linked).
//                   - is_active changes cascade to the linked csms row so
//                     disabling a user also deactivates their CSM record.
//   DELETE soft-delete via { id }   (sets is_active=false on app_users AND
//          on the linked csms row; we never hard-delete to preserve audit
//          trails)
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

const PUBLIC_FIELDS = "id,username,email,full_name,role,is_active,must_reset,last_login_at,failed_attempts,locked_until,csm_id,created_at,updated_at";

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

// Upsert a csms row keyed by email and return its id. Used when a new user
// is created with a Title or an existing user is given one.
async function upsertCsm({ email, name, title, isActive }) {
  // Try to find by email first — emails are unique-ish in practice and we
  // don't have a unique constraint to lean on for ON CONFLICT.
  const existing = email
    ? await sbGet("csms", { select: "id,name,role,is_active", email: "eq." + email })
    : [];
  if (existing && existing[0]) {
    const row = existing[0];
    const patch = {};
    if (name && name !== row.name) patch.name = name;
    if (title && title !== row.role) patch.role = title;
    if (typeof isActive === "boolean" && isActive !== row.is_active) patch.is_active = isActive;
    if (Object.keys(patch).length) {
      await sbUpdate("csms", { id: "eq." + row.id }, patch);
    }
    return row.id;
  }
  const inserted = await sbInsert("csms", [{
    name: name || email || "Unnamed",
    email: email || null,
    role: title || "CSM",
    is_active: typeof isActive === "boolean" ? isActive : true,
  }]);
  const created = Array.isArray(inserted) ? inserted[0] : inserted;
  return created?.id || null;
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
      const [rows, csms] = await Promise.all([
        sbGet("app_users", { select: PUBLIC_FIELDS, order: "username.asc" }),
        sbGet("csms", { select: "id,name,role,is_active" }),
      ]);
      const csmById = new Map((csms || []).map(c => [c.id, c]));
      const enriched = (rows || []).map(u => {
        const c = u.csm_id ? csmById.get(u.csm_id) : null;
        return {
          ...u,
          csm_name: c?.name || null,
          csm_title: c?.role || null,
          csm_is_active: c?.is_active ?? null,
        };
      });
      return json(res, 200, { users: enriched });
    } catch (e) { return fail(res, 502, "Failed to list users.", { detail: e.message }); }
  }

  if (req.method === "POST") {
    const username = (body.username || "").toString().trim();
    const email    = (body.email || "").toString().trim().toLowerCase();
    const fullName = (body.full_name || "").toString().trim() || null;
    const role     = (body.role || "viewer").toString();
    const password = (body.password || "").toString();
    const csmTitle = (body.csm_title || "").toString().trim() || null;
    if (!username || !email) return fail(res, 400, "Username and email are required.");
    if (!(await isValidRoleName(role))) return fail(res, 400, "Invalid role.");
    const pwErr = await validatePassword(password);
    if (pwErr) return fail(res, 400, pwErr);

    try {
      // If they're also a CSM, create/link the csms row first so the
      // app_users insert can carry csm_id atomically.
      let csmId = null;
      if (csmTitle) {
        csmId = await upsertCsm({ email, name: fullName || username, title: csmTitle, isActive: true });
      }

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const inserted = await sbInsert("app_users", [{
        username, email, full_name: fullName, password_hash: hash, role,
        is_active: true, must_reset: !!body.must_reset, csm_id: csmId,
      }]);
      const created = Array.isArray(inserted) ? inserted[0] : inserted;
      const safe = created ? { ...created, password_hash: undefined } : null;
      await audit(session.user, "user.create", created?.id, { username, email, role, csm_title: csmTitle });
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
      patch.must_reset = !!body.must_reset;
      patch.failed_attempts = 0;
      patch.locked_until = null;
    }

    const csmTitle = body.csm_title != null ? (body.csm_title || "").toString().trim() : undefined;

    if (!Object.keys(patch).length && csmTitle === undefined) {
      return fail(res, 400, "No fields to update.");
    }

    if (id === session.user_id && (patch.role && patch.role !== "admin")) {
      return fail(res, 400, "You cannot remove admin role from your own account.");
    }
    if (id === session.user_id && patch.is_active === false) {
      return fail(res, 400, "You cannot disable your own account.");
    }

    try {
      // Pull the current row so we know whether they have a linked csms id
      // and what email to use when upserting.
      const currentRows = await sbGet("app_users", { select: "id,email,full_name,csm_id,is_active", id: "eq." + id });
      const current = Array.isArray(currentRows) ? currentRows[0] : null;

      // Title management: create/update linked csms row, attach to user.
      if (csmTitle !== undefined) {
        if (csmTitle === "") {
          // Title cleared — unlink from csms (but don't delete the csms row;
          // it may still be used historically by projects).
          patch.csm_id = null;
        } else {
          const email = (patch.email || current?.email || "").toLowerCase();
          const name  = patch.full_name || current?.full_name || null;
          const newCsmId = await upsertCsm({
            email,
            name,
            title: csmTitle,
            isActive: patch.is_active != null ? patch.is_active : (current?.is_active ?? true),
          });
          patch.csm_id = newCsmId;
        }
      }

      // Cascade is_active to the linked csms row (whether the link existed
      // before this patch or was just set above).
      const finalCsmId = patch.csm_id !== undefined ? patch.csm_id : current?.csm_id;
      if (typeof patch.is_active === "boolean" && finalCsmId) {
        await sbUpdate("csms", { id: "eq." + finalCsmId }, { is_active: patch.is_active });
      }

      const updated = Object.keys(patch).length
        ? await sbUpdate("app_users", { id: "eq." + id }, patch)
        : currentRows;
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
      const currentRows = await sbGet("app_users", { select: "id,csm_id", id: "eq." + id });
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      await sbUpdate("app_users", { id: "eq." + id }, { is_active: false });
      // Cascade: disabling a user also deactivates their CSM record so they
      // disappear from assignment dropdowns.
      if (current?.csm_id) {
        await sbUpdate("csms", { id: "eq." + current.csm_id }, { is_active: false });
      }
      await audit(session.user, "user.disable", id, {});
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, 502, "Failed to disable user.", { detail: e.message }); }
  }

  return fail(res, 405, "Method not allowed.");
}
