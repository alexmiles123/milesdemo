// /api/admin/roles
//
// CRUD over the app_roles table. Only admins can read or write — every
// non-admin endpoint that needs to know the role list (e.g. the user-create
// modal opened by a non-admin) is gated upstream by requireRole anyway.
//
// Methods:
//   GET    list roles (sorted)
//   POST   create   { name, label, description?, can_view_exec?, can_view_config?, sort_order? }
//   PATCH  update   { name, label?, description?, can_view_exec?, can_view_config?, sort_order? }
//   DELETE soft-rule: system roles can't be deleted, and a role can't be
//          deleted while it's still assigned to any active app_user.
//
// The role validator in api/admin/users.js reads through a 60s in-process
// cache (api/_lib/roles.js); every mutation here invalidates it so the
// next user-create call sees the fresh list.

import { hardenResponse, fail, json, rateLimit } from "../_lib/security.js";
import { requireAuth, requireRole } from "../_lib/auth.js";
import { sbConfigured, sbGet, sbInsert, sbUpdate, sbDelete } from "../_lib/sb.js";
import { writeAudit } from "../_lib/supabase.js";
import { invalidateRoles, isSystemRole } from "../_lib/roles.js";

const NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rl = rateLimit(req, "admin-roles");
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
      const rows = await sbGet("app_roles", { select: "*", order: "sort_order.asc,name.asc" });
      return json(res, 200, { roles: rows || [] });
    } catch (e) { return fail(res, 502, "Failed to list roles.", { detail: e.message }); }
  }

  if (req.method === "POST") {
    const name  = (body.name || "").toString().trim().toLowerCase();
    const label = (body.label || "").toString().trim();
    if (!NAME_RE.test(name)) return fail(res, 400, "Role name must start with a letter and use only lowercase letters, digits, and underscores (max 32).");
    if (!label) return fail(res, 400, "Label is required.");
    try {
      const inserted = await sbInsert("app_roles", [{
        name,
        label,
        description:     (body.description || "").toString().trim() || null,
        can_view_exec:   !!body.can_view_exec,
        can_view_config: !!body.can_view_config,
        sort_order:      Number.isInteger(body.sort_order) ? body.sort_order : 100,
        is_system:       false,
      }]);
      invalidateRoles();
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      await writeAudit({
        actor:        String(session.user || "unknown"),
        actor_role:   String(session.role || "user"),
        action:       "app_role.create",
        target_table: "app_roles",
        target_id:    name,
        after_state:  row,
      });
      return json(res, 201, { role: row });
    } catch (e) {
      const msg = (e.message || "").includes("duplicate") ? "A role with that name already exists." : "Failed to create role.";
      return fail(res, 400, msg, { detail: e.message });
    }
  }

  if (req.method === "PATCH") {
    const name = (body.name || "").toString().trim().toLowerCase();
    if (!name) return fail(res, 400, "name is required.");
    const before = (await sbGet("app_roles", { select: "*", name: "eq." + name, limit: "1" }))?.[0];
    if (!before) return fail(res, 404, "Role not found.");

    const patch = {};
    if (body.label != null) {
      const label = body.label.toString().trim();
      if (!label) return fail(res, 400, "Label cannot be empty.");
      patch.label = label;
    }
    if (body.description != null) patch.description = body.description.toString().trim() || null;
    if (body.can_view_exec   != null) patch.can_view_exec   = !!body.can_view_exec;
    if (body.can_view_config != null) patch.can_view_config = !!body.can_view_config;
    if (body.sort_order      != null && Number.isInteger(body.sort_order)) patch.sort_order = body.sort_order;

    if (!Object.keys(patch).length) return fail(res, 400, "No fields to update.");

    // Don't let an admin lock themselves out by stripping can_view_config
    // from the admin role. The system-role guard below already blocks
    // renames/deletes; this catches the permission-flag case.
    if (before.is_system && before.name === "admin" && (patch.can_view_config === false || patch.can_view_exec === false)) {
      return fail(res, 400, "Admin role must retain access to the executive and configuration views.");
    }

    try {
      const updated = await sbUpdate("app_roles", { name: "eq." + name }, patch);
      invalidateRoles();
      const row = Array.isArray(updated) ? updated[0] : updated;
      await writeAudit({
        actor:        String(session.user || "unknown"),
        actor_role:   String(session.role || "user"),
        action:       "app_role.update",
        target_table: "app_roles",
        target_id:    name,
        before_state: before,
        after_state:  row,
        metadata:     { fields: Object.keys(patch) },
      });
      return json(res, 200, { role: row });
    } catch (e) { return fail(res, 502, "Failed to update role.", { detail: e.message }); }
  }

  if (req.method === "DELETE") {
    const name = (body.name || "").toString().trim().toLowerCase();
    if (!name) return fail(res, 400, "name is required.");
    if (isSystemRole(name)) return fail(res, 400, "System roles cannot be deleted.");

    // Block deletion if any user still has this role; reassign first.
    try {
      const inUse = await sbGet("app_users", { select: "id", role: "eq." + name, limit: "1" });
      if (Array.isArray(inUse) && inUse.length) {
        return fail(res, 409, "This role is assigned to one or more users. Reassign them before deleting.");
      }
    } catch (_) { /* if the lookup fails, fall through and let the delete attempt proceed */ }

    try {
      const before = (await sbGet("app_roles", { select: "*", name: "eq." + name, limit: "1" }))?.[0];
      if (!before) return fail(res, 404, "Role not found.");
      await sbDelete("app_roles", { name: "eq." + name });
      invalidateRoles();
      await writeAudit({
        actor:        String(session.user || "unknown"),
        actor_role:   String(session.role || "user"),
        action:       "app_role.delete",
        target_table: "app_roles",
        target_id:    name,
        before_state: before,
      });
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, 502, "Failed to delete role.", { detail: e.message }); }
  }

  return fail(res, 405, "Method not allowed.");
}
