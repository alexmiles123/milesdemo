-- ============================================================================
-- MONUMENT — APP ROLES (idempotent)
--
-- Moves the previously-hardcoded role list (admin / csm / viewer) into a
-- table so an admin can add custom roles for the broader org (e.g.
-- "Director", "Sales Engineer") without a code change. Each role carries
-- a small set of view-permission flags that the React app reads to gate
-- the executive dashboard and the configuration surface.
--
-- Why a table rather than another column on app_users:
--   * Multiple users share a role and the permission semantics live on the
--     role itself — keeping them in one place avoids drift when an admin
--     wants to broaden, say, Director access to the exec dashboard.
--   * Lets us tag the three baked-in roles as `is_system = true` so the UI
--     can prevent rename/delete of names the API still references by string.
--
-- The validator in /api/admin/users.js queries this table (via a 60s cache,
-- mirroring the password-policy pattern) so any new role added here is
-- immediately assignable from the user-create modal.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_roles (
  name             TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  description      TEXT,
  can_view_exec    BOOLEAN NOT NULL DEFAULT false,
  can_view_config  BOOLEAN NOT NULL DEFAULT false,
  is_system        BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT     NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_roles_name_lower CHECK (name = lower(name) AND name ~ '^[a-z][a-z0-9_]*$')
);

INSERT INTO app_roles (name, label, description, can_view_exec, can_view_config, is_system, sort_order) VALUES
  ('admin',  'Administrator',    'Full access. Can manage users, roles, integrations, and view every dashboard.', true,  true,  true, 10),
  ('csm',    'CSM / Consultant', 'Consultant portal access for assigned customer accounts.',                       false, false, true, 20),
  ('viewer', 'Viewer',           'Read-only consultant view. No edits.',                                           false, false, true, 30)
ON CONFLICT (name) DO NOTHING;

DROP TRIGGER IF EXISTS trg_app_roles_updated ON app_roles;
CREATE TRIGGER trg_app_roles_updated BEFORE UPDATE ON app_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Same posture as app_users / password_policy: never readable through the
-- /api/db catch-all proxy. Reads + writes go through /api/admin/roles.
ALTER TABLE app_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_roles FROM anon, authenticated;

COMMENT ON TABLE app_roles IS
  'Application roles with view-level permission flags. System roles '
  '(admin/csm/viewer) cannot be deleted; custom roles can be added to '
  'extend access to additional people in the org.';
