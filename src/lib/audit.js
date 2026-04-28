// Client-side audit helper. Fires-and-forgets to the server endpoint, which
// applies the service-role key and writes an immutable row to audit_log.
//
// The endpoint requires a valid session — cookies are attached automatically
// by authedFetch.

import { authedFetch, getCachedSession, getLegacyToken } from "./auth.js";

export async function audit(action, target_table, target_id, { before, after, metadata } = {}) {
  // Skip when the user isn't signed in — audit rows should only record
  // authenticated actions.
  if (!getCachedSession() && !getLegacyToken()) return;
  try {
    await authedFetch("/api/audit", {
      method: "POST",
      body: JSON.stringify({
        action, target_table, target_id,
        before_state: before || null,
        after_state: after || null,
        metadata: metadata || {},
      }),
      keepalive: true,
    });
  } catch {
    // Intentionally swallow. Audit failures must never break the user action.
    // The server endpoint itself logs to Vercel if the write fails.
  }
}

// Wrap a DB mutation so it's automatically audited. Returns the mutation's
// result. If the mutation throws, the audit records the attempt + failure.
export async function audited(action, target_table, target_id, fn, opts = {}) {
  try {
    const result = await fn();
    audit(action, target_table, target_id, { after: opts.after, before: opts.before, metadata: opts.metadata });
    return result;
  } catch (err) {
    audit(action + ".failed", target_table, target_id, {
      before: opts.before,
      metadata: { ...(opts.metadata || {}), error: String(err && err.message || err) },
    });
    throw err;
  }
}
