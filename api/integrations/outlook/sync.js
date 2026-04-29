// POST /api/integrations/outlook/sync
//
// Backfills the last 24 hours of email activity from each CSM's mailbox and
// stores matching messages as customer_interactions.
//
// How it works:
//   1. Acquire an app-only OAuth token (client credentials, no user sign-in).
//   2. Load all CSM emails from the `csms` table.
//   3. Load all customer contact emails from the `customers` table.
//   4. For each CSM mailbox: fetch messages received/sent in the last 24h via
//      Microsoft Graph  GET /v1.0/users/{csm_email}/messages
//   5. For each message: check if any participant email matches a customer.
//   6. Upsert matches into customer_interactions (idempotent via external_id).
//
// Required Azure AD app permissions (Application, not Delegated):
//   • Mail.Read          — read all users' mail
//   • User.Read.All      — enumerate users / look up mailboxes by UPN
//   • Calendars.Read     — (optional) read calendar events for meeting sync
//
// Admin consent must be granted by a Global Administrator.

import { rateLimit, hardenResponse, requestId, fail, json } from "../../_lib/security.js";
import { sbGet, sbPost, sbPatch, writeAudit } from "../../_lib/supabase.js";
import { requireAuth } from "../../_lib/auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const LOOK_BACK_HOURS = 24;

async function getToken(tenantId, clientId, clientSecret) {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }).toString(),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error("Token request failed: " + err.slice(0, 200));
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchMessages(token, userEmail, since) {
  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
  const select = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isDraft,isRead";
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/messages?$filter=${filter}&$select=${select}&$top=50&$orderby=receivedDateTime+desc`;

  const res = await fetch(url, { headers: { Authorization: "Bearer " + token, ConsistencyLevel: "eventual" } });
  if (res.status === 404 || res.status === 403) return []; // mailbox not found or no permission — skip silently
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Graph messages error for ${userEmail}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.value || [];
}

function extractEmails(message) {
  const addrs = new Set();
  const push = (r) => { if (r?.emailAddress?.address) addrs.add(r.emailAddress.address.toLowerCase()); };
  push(message.from);
  (message.toRecipients || []).forEach(push);
  (message.ccRecipients  || []).forEach(push);
  return addrs;
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "outlook-sync", 1);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const rid = requestId(req);

  // ── Load integration config ───────────────────────────────────────────────
  let integration;
  try {
    const rows = await sbGet("integrations", { provider: "eq.outlook", select: "*" });
    integration = rows && rows[0];
  } catch { return fail(res, 500, "Integration lookup failed."); }
  if (!integration) return fail(res, 404, "Integration not registered.");

  const cfg = integration.config || {};
  const secret = integration.credential_ref ? process.env[integration.credential_ref] : null;
  if (!cfg.tenant_id || !cfg.client_id || !secret) {
    return json(res, 200, { ok: false, error: "Integration not fully configured." });
  }

  // Record this sync run
  let runId;
  try {
    const [run] = await sbPost("sync_runs", [{
      integration_id: integration.id,
      trigger: "manual",
      status: "running",
      started_at: new Date().toISOString(),
    }]);
    runId = run?.id;
  } catch { /* non-fatal */ }

  const sinceDate = new Date(Date.now() - LOOK_BACK_HOURS * 3600 * 1000).toISOString();
  let recordsIn = 0, recordsUpserted = 0, errorMsg = null;

  try {
    const token = await getToken(cfg.tenant_id, cfg.client_id, secret);

    // ── Load CSM emails + customer emails from Supabase ───────────────────
    const [csms, customers] = await Promise.all([
      sbGet("csms", { select: "id,email", is_active: "eq.true" }).catch(() => []),
      sbGet("customers", { select: "id,contact_email", is_active: "eq.true" }).catch(() => []),
    ]);

    // Build email → customer_id lookup (lowercase)
    const customerByEmail = {};
    for (const c of customers || []) {
      if (c.contact_email) customerByEmail[c.contact_email.toLowerCase()] = c.id;
    }

    const csmEmails = (csms || []).map(c => c.email).filter(Boolean);
    if (!csmEmails.length) {
      return json(res, 200, { ok: true, records_in: 0, records_upserted: 0, detail: "No CSM emails on file." });
    }

    const rows = [];
    for (const csmEmail of csmEmails) {
      let messages;
      try { messages = await fetchMessages(token, csmEmail, sinceDate); }
      catch (e) { console.warn("[outlook-sync]", e.message); continue; }

      recordsIn += messages.length;

      for (const msg of messages) {
        if (msg.isDraft) continue;

        const participants = extractEmails(msg);
        const matchedCustomerId = [...participants].map(e => customerByEmail[e]).find(Boolean);
        if (!matchedCustomerId) continue;

        rows.push({
          customer_id:      matchedCustomerId,
          interaction_type: "email",
          source_system:    "outlook",
          external_id:      msg.id,
          subject:          (msg.subject || "(no subject)").slice(0, 500),
          body:             (msg.bodyPreview || "").slice(0, 2000),
          occurred_at:      msg.receivedDateTime,
          participants:     JSON.stringify([...participants]),
        });
      }
    }

    if (rows.length) {
      // Upsert in batches of 50 (Supabase PostgREST limit per request)
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        try {
          await sbPost("customer_interactions", batch, "resolution=ignore-duplicates");
          recordsUpserted += batch.length;
        } catch (e) {
          console.warn("[outlook-sync] batch upsert error:", e.message);
        }
      }
    }

    // Mark integration last_sync_at
    await sbPatch("integrations", { id: "eq." + integration.id }, {
      last_sync_at: new Date().toISOString(),
      last_error: null,
      status: "connected",
    }).catch(() => {});

    // Update sync run
    if (runId) {
      await sbPatch("sync_runs", { id: "eq." + runId }, {
        status: "succeeded",
        completed_at: new Date().toISOString(),
        records_in: recordsIn,
        records_upserted: recordsUpserted,
        records_skipped: recordsIn - recordsUpserted,
      }).catch(() => {});
    }

    writeAudit({
      actor: session.user || "unknown", actor_role: session.role || "user",
      action: "integration.sync", target_table: "integrations", target_id: integration.id,
      request_id: rid,
      metadata: { provider: "outlook", records_in: recordsIn, records_upserted: recordsUpserted },
    });

    return json(res, 200, { ok: true, records_in: recordsIn, records_upserted: recordsUpserted });

  } catch (err) {
    errorMsg = (err.message || "unknown").slice(0, 500);
    console.error("[outlook-sync]", err);

    await sbPatch("integrations", { id: "eq." + integration.id }, {
      last_error: errorMsg, status: "error",
    }).catch(() => {});

    if (runId) {
      await sbPatch("sync_runs", { id: "eq." + runId }, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMsg,
        records_in: recordsIn,
        records_upserted: recordsUpserted,
      }).catch(() => {});
    }

    return fail(res, 502, "Sync failed: " + errorMsg);
  }
}
