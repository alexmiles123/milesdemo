// Client-side helper for the app_roles table. Mirrors the system fallback
// in api/_lib/roles.js so the UI degrades gracefully when migration 010
// hasn't been applied yet.

export const SYSTEM_ROLES = [
  { name: "admin",  label: "Administrator",    description: "Full access. Can manage users, roles, integrations, and view every dashboard.", can_view_exec: true,  can_view_config: true,  is_system: true, sort_order: 10 },
  { name: "csm",    label: "CSM / Consultant", description: "Consultant portal access for assigned customer accounts.",                       can_view_exec: false, can_view_config: false, is_system: true, sort_order: 20 },
  { name: "viewer", label: "Viewer",           description: "Read-only consultant view. No edits.",                                           can_view_exec: false, can_view_config: false, is_system: true, sort_order: 30 },
];

export async function fetchRoles(api) {
  try {
    const data = await api.call("/api/admin/roles");
    const rows = (data && data.roles) || [];
    return rows.length ? rows : SYSTEM_ROLES;
  } catch {
    // Non-admin sessions get a 403 here. Fall back to the baked-in list so
    // the user-create UI still has something to put in the dropdown.
    return SYSTEM_ROLES;
  }
}

export function roleOptions(roles) {
  return (roles || []).map(r => ({ value: r.name, label: r.label || r.name }));
}
