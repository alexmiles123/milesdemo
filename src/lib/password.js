// Client-side password policy helpers. Mirror api/_lib/password.js so the UI
// can give immediate feedback that lines up exactly with what the server
// will enforce. Always treat the server's response as authoritative — these
// validators are convenience only.

export const DEFAULT_POLICY = {
  min_length: 12,
  require_upper: true,
  require_lower: true,
  require_number: true,
  require_symbol: true,
};

export async function fetchPasswordPolicy(api) {
  try {
    const data = await api.call("/api/password-policy");
    return data?.policy || DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

export function describePolicy(p) {
  const parts = [`${p.min_length}+ chars`];
  if (p.require_upper)  parts.push("upper");
  if (p.require_lower)  parts.push("lower");
  if (p.require_number) parts.push("number");
  if (p.require_symbol) parts.push("symbol");
  return parts.join(" \u00b7 ");
}

export function validatePasswordWith(pw, policy) {
  if (typeof pw !== "string" || pw.length < policy.min_length) {
    return `Password must be at least ${policy.min_length} characters.`;
  }
  if (policy.require_upper  && !/[A-Z]/.test(pw))         return "Password must include an uppercase letter.";
  if (policy.require_lower  && !/[a-z]/.test(pw))         return "Password must include a lowercase letter.";
  if (policy.require_number && !/[0-9]/.test(pw))         return "Password must include a number.";
  if (policy.require_symbol && !/[^A-Za-z0-9]/.test(pw))  return "Password must include a symbol.";
  return null;
}
