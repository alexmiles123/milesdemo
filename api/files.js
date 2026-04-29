// File attachments endpoint.
//
// One handler, three verbs:
//   POST   /api/files           — upload bytes + record metadata
//   GET    /api/files?id=<uuid> — return a short-lived signed download URL
//   DELETE /api/files?id=<uuid> — remove the row + the underlying object
//
// The browser does NOT talk to Supabase Storage directly. Bytes go through
// this endpoint so the service key never reaches the client and so we can
// enforce per-CSM ownership before granting any access. Files live in the
// private `project-files` bucket created by migrations/016.
//
// Upload format is base64 inside JSON. That caps us at Vercel's request body
// limit (~4.5MB for hobby; ~5MB after b64 overhead → ~3.3MB raw), which is
// fine for the PSA attachment use case (PDFs, screenshots, spreadsheets).
// If we ever need bigger files, swap to a signed-upload-URL flow.

import crypto from "node:crypto";
import { hardenResponse, fail, failUpstream, rateLimit, requestId, redactSecrets } from "./_lib/security.js";
import { requireAuth } from "./_lib/auth.js";
import { sbGet, sbPost, writeAudit } from "./_lib/supabase.js";

const BUCKET = "project-files";
const MAX_BYTES = 5 * 1024 * 1024;        // 5 MB raw cap
const SIGN_EXPIRES_SEC = 60;              // download URL TTL
const ALLOWED_MIME = /^(image\/|application\/pdf$|application\/vnd\.|application\/msword$|application\/zip$|text\/)/;

function storageUrl(path) {
  return (process.env.SUPABASE_URL || "").replace(/\/$/, "") + "/storage/v1" + path;
}

function storageHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    ...extra,
  };
}

// Caller must own the project (or be an admin) to attach to it. We don't trust
// the request body to declare csm_id — we look it up from the projects table.
async function projectBelongsToCaller(projectId, session) {
  if (session.role === "admin") return true;
  if (!session.csm_id) return false;
  const rows = await sbGet("projects", {
    select: "id,csm_id",
    id: "eq." + projectId,
    limit: 1,
  });
  const proj = Array.isArray(rows) ? rows[0] : null;
  return Boolean(proj && proj.csm_id === session.csm_id);
}

// For account-level file uploads, verify the caller has at least one project
// assigned to this customer (which is how they have access to the account page).
async function customerBelongsToCaller(customerId, session) {
  if (session.role === "admin") return true;
  if (!session.csm_id) return false;
  const rows = await sbGet("projects", {
    select: "id",
    customer_id: "eq." + customerId,
    csm_id: "eq." + session.csm_id,
    limit: 1,
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function attachmentBelongsToCaller(attachmentId, session) {
  const rows = await sbGet("project_attachments", {
    select: "id,project_id,csm_id,storage_path,file_name,mime_type",
    id: "eq." + attachmentId,
    limit: 1,
  });
  const att = Array.isArray(rows) ? rows[0] : null;
  if (!att) return { att: null, ok: false };
  if (session.role === "admin") return { att, ok: true };
  return { att, ok: att.csm_id && att.csm_id === session.csm_id };
}

async function handleUpload(req, res, session) {
  let bodyText;
  try { bodyText = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}); } catch { bodyText = ""; }
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { return fail(res, 400, "Invalid JSON body."); }

  const { project_id, customer_id, task_id, phase, file_name, mime_type, content_base64 } = body || {};
  if (!project_id && !customer_id) {
    return fail(res, 400, "project_id or customer_id is required.");
  }
  if (!file_name || !content_base64) {
    return fail(res, 400, "file_name and content_base64 are required.");
  }
  if (typeof file_name !== "string" || file_name.length > 200) {
    return fail(res, 400, "file_name must be a string ≤ 200 chars.");
  }
  if (mime_type && !ALLOWED_MIME.test(String(mime_type))) {
    return fail(res, 400, "Unsupported mime type.");
  }

  let bytes;
  try { bytes = Buffer.from(String(content_base64), "base64"); } catch { return fail(res, 400, "content_base64 is not valid base64."); }
  if (!bytes.length) return fail(res, 400, "Empty file.");
  if (bytes.length > MAX_BYTES) return fail(res, 413, `File exceeds ${MAX_BYTES} bytes.`);

  if (project_id) {
    const owns = await projectBelongsToCaller(project_id, session);
    if (!owns) return fail(res, 403, "You do not own this project.");
  } else {
    const owns = await customerBelongsToCaller(customer_id, session);
    if (!owns) return fail(res, 403, "You do not have access to this customer.");
  }

  // Storage path: project-scoped uses <project_id>/<uuid>-<name>;
  // account-scoped uses customers/<customer_id>/<uuid>-<name>.
  const safeName = file_name.replace(/[^\w.\- ]+/g, "_");
  const storagePath = project_id
    ? `${project_id}/${crypto.randomUUID()}-${safeName}`
    : `customers/${customer_id}/${crypto.randomUUID()}-${safeName}`;

  const upUrl = storageUrl(`/object/${BUCKET}/${encodeURI(storagePath)}`);
  const upRes = await fetch(upUrl, {
    method: "POST",
    headers: storageHeaders({
      "Content-Type": mime_type || "application/octet-stream",
      "x-upsert": "false",
    }),
    body: bytes,
  });
  if (!upRes.ok) {
    const detail = await upRes.text().catch(() => "");
    return failUpstream(res, session, 502, "Storage upload failed.", new Error(detail));
  }

  // Record metadata. csm_id is the caller's so dbAuthz / RLS keeps the row
  // visible only to them (and admins).
  let row;
  try {
    const inserted = await sbPost("project_attachments", [{
      project_id:  project_id || null,
      customer_id: customer_id || null,
      csm_id:       session.csm_id || null,
      task_id:      task_id || null,
      phase:        phase || null,
      file_name,
      storage_path: storagePath,
      mime_type:    mime_type || null,
      size_bytes:   bytes.length,
      uploaded_by:  String(session.user || "unknown").slice(0, 200),
    }]);
    row = Array.isArray(inserted) ? inserted[0] : inserted;
  } catch (e) {
    // Roll back the upload so we don't leave an orphan blob in storage.
    await fetch(upUrl, { method: "DELETE", headers: storageHeaders() }).catch(() => {});
    return failUpstream(res, session, 502, "Failed to record attachment.", e);
  }

  await writeAudit({
    actor:        String(session.user || "unknown").slice(0, 200),
    actor_role:   String(session.role || "user").slice(0, 200),
    action:       "project_attachments.create",
    target_table: "project_attachments",
    target_id:    row && row.id ? String(row.id) : null,
    after_state:  redactSecrets(row),
    request_id:   requestId(req),
    metadata:     { project_id: project_id || null, customer_id: customer_id || null, file_name, size_bytes: bytes.length },
  });

  res.statusCode = 201;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ attachment: row }));
}

async function handleDownload(req, res, session, id) {
  const { att, ok } = await attachmentBelongsToCaller(id, session);
  if (!att) return fail(res, 404, "Attachment not found.");
  if (!ok)  return fail(res, 403, "You do not have access to this attachment.");

  const signRes = await fetch(
    storageUrl(`/object/sign/${BUCKET}/${encodeURI(att.storage_path)}`),
    {
      method: "POST",
      headers: storageHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGN_EXPIRES_SEC }),
    },
  );
  if (!signRes.ok) {
    const detail = await signRes.text().catch(() => "");
    return failUpstream(res, session, 502, "Failed to sign download URL.", new Error(detail));
  }
  const signed = await signRes.json().catch(() => null);
  // Supabase returns { signedURL: "/object/sign/..." } — prepend the base.
  const path = signed && (signed.signedURL || signed.signedUrl);
  if (!path) return fail(res, 502, "Storage did not return a signed URL.");
  const url = storageUrl(path.startsWith("/") ? path : "/" + path);

  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({
    url,
    file_name: att.file_name,
    mime_type: att.mime_type,
    expires_in: SIGN_EXPIRES_SEC,
  }));
}

async function handleDelete(req, res, session, id) {
  const { att, ok } = await attachmentBelongsToCaller(id, session);
  if (!att) return fail(res, 404, "Attachment not found.");
  if (!ok)  return fail(res, 403, "You do not have access to this attachment.");

  // Remove blob first; if the row delete fails afterwards, a re-run of this
  // request will still 404 cleanly. If the storage delete fails, we don't
  // delete the row — better to leave a row pointing at a missing blob than
  // to lose the audit trail of the file having existed.
  const delObj = await fetch(
    storageUrl(`/object/${BUCKET}/${encodeURI(att.storage_path)}`),
    { method: "DELETE", headers: storageHeaders() },
  );
  if (!delObj.ok && delObj.status !== 404) {
    const detail = await delObj.text().catch(() => "");
    return failUpstream(res, session, 502, "Storage delete failed.", new Error(detail));
  }

  // Delete the metadata row via the REST endpoint directly (no helper for
  // DELETE, and we want to scope by csm_id for csm-role callers).
  const sbUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const filter = session.role === "admin"
    ? `id=eq.${id}`
    : `id=eq.${id}&csm_id=eq.${session.csm_id}`;
  const delRow = await fetch(`${sbUrl}/rest/v1/project_attachments?${filter}`, {
    method: "DELETE",
    headers: storageHeaders({ "Content-Type": "application/json" }),
  });
  if (!delRow.ok) {
    const detail = await delRow.text().catch(() => "");
    return failUpstream(res, session, 502, "Failed to delete attachment row.", new Error(detail));
  }

  await writeAudit({
    actor:        String(session.user || "unknown").slice(0, 200),
    actor_role:   String(session.role || "user").slice(0, 200),
    action:       "project_attachments.delete",
    target_table: "project_attachments",
    target_id:    String(id),
    before_state: redactSecrets(att),
    request_id:   requestId(req),
  });

  res.statusCode = 204;
  return res.end();
}

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const rl = await rateLimit(req, "files");
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return fail(res, 500, "Supabase not configured.");
  }

  if (req.method === "POST")   return handleUpload(req, res, session);

  // GET and DELETE both require the attachment id as a query param.
  const qIdx = (req.url || "").indexOf("?");
  const usp = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : "");
  const id = usp.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return fail(res, 400, "Missing or invalid id.");

  if (req.method === "GET")    return handleDownload(req, res, session, id);
  if (req.method === "DELETE") return handleDelete(req, res, session, id);

  return fail(res, 405, "Method not allowed.");
}
