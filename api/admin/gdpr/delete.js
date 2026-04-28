// POST /api/admin/gdpr/delete
// Body: { email, confirm: "ANONYMIZE", notes? }
//
// Anonymizes a data subject's PII across the schema. We do *not* hard-delete
// because audit_log retention is a SOC 2 requirement — the change history of
// each entity must remain queryable. Instead we replace the personal columns
// with a placeholder and log the operation in gdpr_deletions so we can prove
// compliance on audit.
//
// Tables touched (PII columns only):
//   • app_users.email, app_users.full_name
//   • csms.email
//   • customers.primary_email, customers.phone, customers.address, customers.notes
//   • customer_interactions: rows where body ILIKE %email% have body cleared
//
// The username and the row id stay intact so foreign keys and audit history
// keep working. The account is also deactivated (is_active = false) so the
// subject can no longer sign in.
//
// Admin only. Heavy 60s rate limit so an attacker can't spam this even with
// stolen admin creds.

import { hardenResponse, fail, failUpstream, json, rateLimit } from "../../_lib/security.js";
import { requireAuth, requireRole } from "../../_lib/auth.js";
import { sbConfigured, sbGet, sbUpdate, sbInsert } from "../../_lib/sb.js";
import { writeAudit } from "../../_lib/supabase.js";

const ANON_EMAIL = "redacted@gdpr.invalid";
const ANON_TEXT  = "[redacted]";

async function scrub(table, queryFilter, patch) {
  const rows = await sbGet(table, { ...queryFilter, select: "id" });
  const ids = (rows || []).map(r => r.id);
  if (!ids.length) return [];
  // PostgREST `id=in.(a,b,c)` syntax for batch update.
  await sbUpdate(table, { id: "in.(" + ids.join(",") + ")" }, patch);
  return ids;
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "gdpr-delete", 30);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;
  if (!requireRole(session, "admin", res)) return;
  if (!sbConfigured()) return fail(res, 500, "Supabase not configured.");

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON body."); }
  const email = (body?.email || "").toString().trim().toLowerCase();
  const confirm = (body?.confirm || "").toString();
  const notes = (body?.notes || "").toString().slice(0, 4000);
  if (!email) return fail(res, 400, "email is required.");
  if (confirm !== "ANONYMIZE") return fail(res, 400, "confirm must equal 'ANONYMIZE'.");

  try {
    const result = {};

    const userIds = await scrub("app_users", { email: "ilike." + email }, {
      email: ANON_EMAIL, full_name: ANON_TEXT, is_active: false,
    });
    result.app_users = userIds;

    const csmIds = await scrub("csms", { email: "ilike." + email }, {
      email: ANON_EMAIL, is_active: false,
    });
    result.csms = csmIds;

    const customerIds = await scrub("customers", { primary_email: "ilike." + email }, {
      primary_email: ANON_EMAIL, phone: null, address: null, notes: ANON_TEXT,
    });
    result.customers = customerIds;

    const interactionIds = await scrub("customer_interactions", { body: "ilike.*" + email + "*" }, {
      body: ANON_TEXT,
    });
    result.customer_interactions = interactionIds;

    const totalScrubbed =
      result.app_users.length + result.csms.length +
      result.customers.length + result.customer_interactions.length;

    // Compliance log — never let this fail block the user response.
    try {
      await sbInsert("gdpr_deletions", {
        actor:        String(session.user || "unknown"),
        subject_kind: result.app_users.length ? "app_user" :
                      result.csms.length ? "csm" :
                      result.customers.length ? "customer" : "unknown",
        subject_id:   String((result.app_users[0] || result.csms[0] || result.customers[0] || email)),
        subject_email: email,
        scrubbed_fields: result,
        notes:        notes || null,
      }, "return=minimal");
    } catch (_) { /* ignore */ }

    await writeAudit({
      actor:        String(session.user || "unknown"),
      actor_role:   String(session.role || "admin"),
      action:       "gdpr.delete",
      target_table: "gdpr_deletions",
      target_id:    null,
      metadata:     { email, total: totalScrubbed, ...result, notes },
    });

    return json(res, 200, { ok: true, email, total_rows_scrubbed: totalScrubbed, detail: result });
  } catch (e) {
    return failUpstream(res, session, 502, "GDPR deletion failed.", e);
  }
}
