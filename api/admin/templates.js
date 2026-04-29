// /api/admin/templates — admin-only CRUD over task_templates + items.
//
// Methods:
//   GET                    list all templates with their items
//   POST   { name, description?, is_default?, items: [{name,phase,priority,
//             estimated_hours,day_offset,notes,sort_order}] }
//   PATCH  { id, ...partial, items? }   (items, if provided, replace all)
//   DELETE { id }
//
// We never expose this through /api/db so the frontend can ask for the
// header + items in a single call rather than client-side joining.

import { hardenResponse, fail, json, rateLimit } from "../_lib/security.js";
import { requireAuth, requireRole } from "../_lib/auth.js";
import { sbGet, sbInsert, sbUpdate, sbDelete, sbConfigured } from "../_lib/sb.js";

const VALID_PRIORITY = new Set(["critical", "high", "medium", "low"]);
const VALID_PHASE    = new Set(["Analysis","Design","Develop","Evaluate","Deploy"]);

function sanitizeItem(it, idx) {
  return {
    sort_order:      Number.isFinite(+it.sort_order) ? +it.sort_order : idx + 1,
    name:            (it.name || "").toString().trim().slice(0, 200),
    phase:           VALID_PHASE.has(it.phase) ? it.phase : "Analysis",
    priority:        VALID_PRIORITY.has(it.priority) ? it.priority : "medium",
    estimated_hours: it.estimated_hours == null || it.estimated_hours === "" ? null : +it.estimated_hours,
    day_offset:      Number.isFinite(+it.day_offset) ? +it.day_offset : 0,
    notes:           (it.notes || "").toString().slice(0, 2000) || null,
  };
}

async function audit(actor, action, entityId, metadata) {
  try {
    await sbInsert("audit_log", {
      actor: actor || "unknown",
      action,
      entity_type: "task_template",
      entity_id: entityId,
      metadata: metadata || {},
    }, "return=minimal");
  } catch (_) { /* noop */ }
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rl = await rateLimit(req, "admin-templates");
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
      const headers = await sbGet("task_templates", { select: "*", order: "name.asc" });
      const items   = await sbGet("task_template_items", { select: "*", order: "template_id.asc,sort_order.asc" });
      const byTpl = {};
      for (const it of (items || [])) {
        (byTpl[it.template_id] = byTpl[it.template_id] || []).push(it);
      }
      const out = (headers || []).map(h => ({ ...h, items: byTpl[h.id] || [] }));
      return json(res, 200, { templates: out });
    } catch (e) { return fail(res, 502, "Failed to load templates.", { detail: e.message }); }
  }

  if (req.method === "POST") {
    const name = (body.name || "").toString().trim();
    if (!name) return fail(res, 400, "Template name is required.");
    const items = Array.isArray(body.items) ? body.items : [];
    try {
      // If is_default is requested, unflag any existing default first so the
      // partial unique index doesn't refuse the insert.
      if (body.is_default) await sbUpdate("task_templates", { is_default: "eq.true" }, { is_default: false });
      const inserted = await sbInsert("task_templates", [{
        name,
        description: (body.description || "").toString().trim() || null,
        is_default: !!body.is_default,
        is_active: true,
      }]);
      const tpl = Array.isArray(inserted) ? inserted[0] : inserted;
      if (items.length) {
        await sbInsert("task_template_items", items.map((it, i) => ({ template_id: tpl.id, ...sanitizeItem(it, i) })), "return=minimal");
      }
      await audit(session.user, "template.create", tpl.id, { name, item_count: items.length });
      return json(res, 201, { template: { ...tpl, items: items.map((it, i) => sanitizeItem(it, i)) } });
    } catch (e) {
      const msg = e.message?.includes("duplicate") ? "A template with that name already exists." : "Failed to create template.";
      return fail(res, 400, msg);
    }
  }

  if (req.method === "PATCH") {
    const id = (body.id || "").toString();
    if (!id) return fail(res, 400, "id is required.");
    const patch = {};
    if (body.name != null)        patch.name        = body.name.toString().trim();
    if (body.description != null) patch.description = body.description.toString().trim() || null;
    if (body.is_active != null)   patch.is_active   = !!body.is_active;
    if (body.is_default === true) {
      await sbUpdate("task_templates", { is_default: "eq.true" }, { is_default: false });
      patch.is_default = true;
    } else if (body.is_default === false) {
      patch.is_default = false;
    }
    try {
      if (Object.keys(patch).length) {
        await sbUpdate("task_templates", { id: "eq." + id }, patch);
      }
      if (Array.isArray(body.items)) {
        await sbDelete("task_template_items", { template_id: "eq." + id });
        if (body.items.length) {
          await sbInsert("task_template_items",
            body.items.map((it, i) => ({ template_id: id, ...sanitizeItem(it, i) })),
            "return=minimal");
        }
      }
      await audit(session.user, "template.update", id, { fields: Object.keys(patch), items_replaced: Array.isArray(body.items) });
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, 502, "Failed to update template.", { detail: e.message }); }
  }

  if (req.method === "DELETE") {
    const id = (body.id || "").toString();
    if (!id) return fail(res, 400, "id is required.");
    try {
      await sbDelete("task_templates", { id: "eq." + id });
      await audit(session.user, "template.delete", id, {});
      return json(res, 200, { ok: true });
    } catch (e) { return fail(res, 502, "Failed to delete template.", { detail: e.message }); }
  }

  return fail(res, 405, "Method not allowed.");
}
