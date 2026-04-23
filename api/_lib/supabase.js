// Server-side Supabase REST helpers. These run inside Vercel serverless
// functions with the service-role key, so they bypass RLS and can write to
// tables (including audit_log) that the browser can only read.
//
// All writes go through sbUpsert / sbPost / sbPatch, which return parsed
// JSON arrays and throw on non-2xx so callers can rely on a uniform shape.

const baseUrl = () => (process.env.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";

function headers() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error("Server is missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars.");
  }
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function parse(res) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("Supabase " + res.status + ": " + body.slice(0, 400));
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export async function sbGet(table, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const res = await fetch(baseUrl() + "/" + table + (qs ? "?" + qs : ""), { headers: headers() });
  return parse(res);
}

export async function sbPost(table, body) {
  const res = await fetch(baseUrl() + "/" + table, {
    method: "POST", headers: headers(), body: JSON.stringify(body),
  });
  return parse(res);
}

export async function sbPatch(table, filter, body) {
  const qs = Object.entries(filter).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const res = await fetch(baseUrl() + "/" + table + "?" + qs, {
    method: "PATCH", headers: headers(), body: JSON.stringify(body),
  });
  return parse(res);
}

export async function sbUpsert(table, body, onConflict) {
  const qs = onConflict ? "?on_conflict=" + encodeURIComponent(onConflict) : "";
  const res = await fetch(baseUrl() + "/" + table + qs, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  return parse(res);
}

// ─── Audit writer ───────────────────────────────────────────────────────────
// Always use this — never write to audit_log directly. It quietly no-ops if
// SUPABASE env vars are missing so a misconfigured local run doesn't crash
// the happy path; failures are logged to stderr for Vercel observability.
export async function writeAudit(row) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return;
    }
    await sbPost("audit_log", [row]);
  } catch (err) {
    console.error("[audit] write failed:", err && err.message);
  }
}
