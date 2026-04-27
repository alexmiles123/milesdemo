// Server-side app-roles loader. Single source of truth for which role names
// are assignable to a user — replaces the previous hardcoded VALID_ROLES set
// so adding a role from the Configuration → Roles tab makes it immediately
// available in the user-create modal without a deploy.
//
// Cached in-process for 60s to keep credential writes fast; the TTL is short
// enough that an admin who adds a role sees it apply almost immediately.

import { sbGet, sbConfigured } from "./sb.js";

// System roles must always be valid even if the table lookup fails — they
// match the strings that other parts of the codebase ship/sign into JWTs.
const SYSTEM_ROLES = ["admin", "csm", "viewer"];

const TTL_MS = 60_000;
let cached = null;
let cachedAt = 0;

export async function loadRoles() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (!sbConfigured()) {
    cached = SYSTEM_ROLES.map((name, i) => ({
      name, label: name, description: "", can_view_exec: name === "admin",
      can_view_config: name === "admin", is_system: true, sort_order: (i + 1) * 10,
    }));
    cachedAt = Date.now();
    return cached;
  }
  try {
    const rows = await sbGet("app_roles", { select: "*", order: "sort_order.asc" });
    cached = Array.isArray(rows) && rows.length ? rows : SYSTEM_ROLES.map((name, i) => ({
      name, label: name, is_system: true, sort_order: (i + 1) * 10,
    }));
    cachedAt = Date.now();
    return cached;
  } catch {
    // If the table is missing (migration 010 not yet applied), fall back to
    // the hardcoded system roles so user creation doesn't break.
    return SYSTEM_ROLES.map((name) => ({ name, label: name, is_system: true }));
  }
}

export function invalidateRoles() {
  cached = null;
  cachedAt = 0;
}

export async function isValidRoleName(name) {
  if (!name || typeof name !== "string") return false;
  const roles = await loadRoles();
  return roles.some(r => r.name === name);
}

export function isSystemRole(name) {
  return SYSTEM_ROLES.includes(name);
}
