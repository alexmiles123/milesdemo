// Tiny Supabase REST helper for server-side endpoints that need to talk to
// tables outside the /api/db proxy allowlist (app_users, task templates,
// internal admin actions). Always uses the service_role key — never call
// from anything that ships to the browser.

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export function sbConfigured() {
  return Boolean(SB_URL && SB_KEY);
}

function sbHeaders(extra = {}) {
  return {
    apikey: SB_KEY,
    Authorization: "Bearer " + SB_KEY,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function parse(res) {
  const text = await res.text();
  if (!res.ok) {
    // PostgREST returns JSON like { code, message, details, hint }. Pull the
    // useful pieces up so callers (and audit logs) see the constraint name
    // instead of a row dump that overflows our generic 240-char snippet.
    let summary = text.slice(0, 800);
    try {
      const j = JSON.parse(text);
      const parts = [j.code, j.message, j.details, j.hint].filter(Boolean);
      if (parts.length) summary = parts.join(" — ");
    } catch { /* not JSON, keep raw */ }
    const err = new Error("Supabase request failed: " + res.status + " " + summary);
    err.status = res.status;
    throw err;
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function sbGet(table, query = {}) {
  const usp = new URLSearchParams(query);
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${usp.toString()}`, {
    method: "GET",
    headers: sbHeaders(),
  });
  return parse(r);
}

export async function sbInsert(table, body, prefer = "return=representation") {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({ Prefer: prefer }),
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function sbUpdate(table, query, body) {
  const usp = new URLSearchParams(query);
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${usp.toString()}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function sbDelete(table, query) {
  const usp = new URLSearchParams(query);
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${usp.toString()}`, {
    method: "DELETE",
    headers: sbHeaders(),
  });
  return parse(r);
}
