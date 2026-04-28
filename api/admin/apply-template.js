// POST /api/admin/apply-template
// Body: { project_id, template_id, start_date? }
//
// Stamps every row in task_template_items onto `tasks` for the given project.
// proj_date = (start_date || today) + day_offset.
//
// Re-runnable: callers can re-apply, but each call inserts a fresh batch
// of tasks rather than upserting (no natural key on tasks for that). The
// UI warns before re-applying.

import { hardenResponse, fail, failUpstream, json, rateLimit } from "../_lib/security.js";
import { requireAuth } from "../_lib/auth.js";
import { sbGet, sbInsert, sbConfigured } from "../_lib/sb.js";

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "admin-apply-tpl");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  if (!sbConfigured()) return fail(res, 500, "Supabase not configured.");

  const session = await requireAuth(req, res);
  if (!session) return;
  // CSMs and admins both need this — they create projects.
  if (session.role !== "admin" && session.role !== "csm") {
    return fail(res, 403, "Insufficient permissions.");
  }

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON body."); }
  body = body || {};
  const project_id  = (body.project_id  || "").toString();
  const template_id = (body.template_id || "").toString();
  const startDate   = (body.start_date  || new Date().toISOString().split("T")[0]).toString();
  if (!project_id || !template_id) return fail(res, 400, "project_id and template_id are required.");

  try {
    const projects = await sbGet("projects", { id: "eq." + project_id, select: "id", limit: "1" });
    if (!projects || !projects.length) return fail(res, 404, "Project not found.");

    const items = await sbGet("task_template_items", {
      template_id: "eq." + template_id,
      order: "sort_order.asc",
      select: "name,phase,priority,estimated_hours,day_offset,notes",
    });
    if (!items || !items.length) return fail(res, 400, "Template has no items.");

    // Leave assignee_type unset — the DB has a CHECK constraint
    // (tasks_assignee_type_check) whose allowed values are project-specific,
    // and template-applied tasks are unassigned by default anyway. The
    // column is nullable; assignment happens later via the project UI.
    const tasksToInsert = items.map(it => ({
      project_id,
      name: it.name,
      phase: it.phase,
      priority: it.priority,
      estimated_hours: it.estimated_hours,
      proj_date: addDays(startDate, it.day_offset || 0),
      notes: it.notes || null,
      status: "upcoming",
    }));

    await sbInsert("tasks", tasksToInsert, "return=minimal");

    // Audit
    try {
      await sbInsert("audit_log", {
        actor: session.user || "unknown",
        action: "template.apply",
        entity_type: "project",
        entity_id: project_id,
        metadata: { template_id, items: tasksToInsert.length, start_date: startDate },
      }, "return=minimal");
    } catch (_) { /* never block */ }

    return json(res, 200, { ok: true, tasks_added: tasksToInsert.length });
  } catch (e) {
    return failUpstream(res, session, 502, "Failed to apply template.", e);
  }
}
