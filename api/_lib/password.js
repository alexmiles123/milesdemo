// Server-side password policy loader + validator. Single source of truth for
// the rules enforced on every credential write — admin user create, admin
// user reset, CSM-modal provisioning, and CSM-modal password reset all funnel
// through validatePassword().
//
// The policy lives in the `password_policy` single-row table (migration 009).
// We cache it in-process for 60s so a flurry of writes doesn't fan out into
// repeat lookups; the TTL is short enough that an admin who edits the policy
// will see it apply almost immediately on the next request.

import { sbGet, sbConfigured } from "./sb.js";

const DEFAULT_POLICY = {
  min_length: 12,
  require_upper: true,
  require_lower: true,
  require_number: true,
  require_symbol: true,
};

const TTL_MS = 60_000;
let cached = null;
let cachedAt = 0;

export async function loadPolicy() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (!sbConfigured()) return DEFAULT_POLICY;
  try {
    const rows = await sbGet("password_policy", { select: "*", limit: "1" });
    const row = Array.isArray(rows) ? rows[0] : rows;
    cached = row ? {
      min_length:     Number(row.min_length) || DEFAULT_POLICY.min_length,
      require_upper:  !!row.require_upper,
      require_lower:  !!row.require_lower,
      require_number: !!row.require_number,
      require_symbol: !!row.require_symbol,
    } : DEFAULT_POLICY;
    cachedAt = Date.now();
    return cached;
  } catch {
    // If the lookup fails (table missing, network blip), fall back to the
    // baked-in defaults so credential writes don't 500. Better to enforce a
    // sane default than to let weak passwords through.
    return DEFAULT_POLICY;
  }
}

// Invalidate the cache after the policy is updated so the new rules take
// effect on the very next request rather than waiting out the TTL.
export function invalidatePolicy() {
  cached = null;
  cachedAt = 0;
}

export function describePolicy(p) {
  const parts = [`${p.min_length}+ chars`];
  if (p.require_upper)  parts.push("upper");
  if (p.require_lower)  parts.push("lower");
  if (p.require_number) parts.push("number");
  if (p.require_symbol) parts.push("symbol");
  return parts.join(" \u00b7 ");
}

export function validateAgainstPolicy(pw, policy) {
  if (typeof pw !== "string" || pw.length < policy.min_length) {
    return `Password must be at least ${policy.min_length} characters.`;
  }
  if (policy.require_upper  && !/[A-Z]/.test(pw))         return "Password must include an uppercase letter.";
  if (policy.require_lower  && !/[a-z]/.test(pw))         return "Password must include a lowercase letter.";
  if (policy.require_number && !/[0-9]/.test(pw))         return "Password must include a number.";
  if (policy.require_symbol && !/[^A-Za-z0-9]/.test(pw))  return "Password must include a symbol.";
  return null;
}

// Convenience for endpoints that don't already have a policy in scope.
export async function validatePassword(pw) {
  const policy = await loadPolicy();
  return validateAgainstPolicy(pw, policy);
}
