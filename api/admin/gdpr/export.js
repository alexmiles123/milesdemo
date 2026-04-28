// POST /api/admin/gdpr/export
// Body: { email }
//
// Returns every row in every table that references the supplied email. Used
// to satisfy GDPR / CCPA "subject access requests" — give the data subject
// (or their legal counsel) a complete dump of what we hold.
//
// Strictly admin. Logged to audit_log + gdpr_deletions is NOT touched (this
// is a read, not a deletion).

import { hardenResponse, fail, failUpstream, json, rateLimit } from "../../_lib/security.js";
import { requireAuth, requireRole } from "../../_lib/auth.js";
import { sbConfigured, sbGet } from "../../_lib/sb.js";
import { writeAudit } from "../../_lib/supabase.js";

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "gdpr-export", 5);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;
  if (!requireRole(session, "admin", res)) return;
  if (!sbConfigured()) return fail(res, 500, "Supabase not configured.");

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON body."); }
  const email = (body?.email || "").toString().trim().toLowerCase();
  if (!email) return fail(res, 400, "email is required.");

  try {
    const [appUsers, csms, customers, interactions] = await Promise.all([
      sbGet("app_users",     { select: "id,username,email,full_name,role,is_active,created_at,updated_at,last_login_at", email: "ilike." + email }),
      sbGet("csms",          { select: "id,name,email,role,is_active,created_at",                                       email: "ilike." + email }),
      sbGet("customers",     { select: "id,name,primary_email,phone,address,notes,is_active,created_at",                primary_email: "ilike." + email }),
      sbGet("customer_interactions", { select: "id,customer_id,subject,body,occurred_at,source_system,interaction_type", body: "ilike.*" + email + "*" }),
    ]);

    await writeAudit({
      actor:        String(session.user || "unknown"),
      actor_role:   String(session.role || "admin"),
      action:       "gdpr.export",
      target_table: "app_users",
      target_id:    null,
      metadata:     { email, found: { app_users: appUsers?.length || 0, csms: csms?.length || 0, customers: customers?.length || 0, customer_interactions: interactions?.length || 0 } },
    });

    return json(res, 200, {
      email,
      generated_at: new Date().toISOString(),
      data: { app_users: appUsers, csms, customers, customer_interactions: interactions },
    });
  } catch (e) {
    return failUpstream(res, session, 502, "Failed to export subject data.", e);
  }
}
