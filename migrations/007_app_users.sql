-- ============================================================================
-- MONUMENT — APP USERS (idempotent)
--
-- Replaces the env-var-based single-user login (APP_USER + APP_PASS_HASH) with
-- a real users table so an admin can add, deactivate, and reset platform
-- accounts from the Configuration page.
--
-- Auth flow after this lands:
--   1. /api/auth/login looks up `app_users` by username, verifies bcrypt hash,
--      and signs a JWT containing { user, role, user_id }.
--   2. If the table is empty, the endpoint falls back to APP_USER/APP_PASS_HASH
--      so existing deployments don't lock themselves out during the migration.
--   3. /api/admin/users (admin role only) handles create / update / disable.
--
-- Roles (least privilege):
--   admin  — full access to Configuration + every dashboard
--   csm    — consultant portal + their own assigned accounts
--   viewer — read-only dashboards
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin','csm','viewer')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  must_reset      BOOLEAN NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users (lower(username));
CREATE INDEX IF NOT EXISTS idx_app_users_email_lower    ON app_users (lower(email));

DROP TRIGGER IF EXISTS trg_app_users_updated ON app_users;
CREATE TRIGGER trg_app_users_updated BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: same posture as the rest of the app — all access goes through the
-- service role via the API layer, never directly from the browser. The
-- /api/db proxy explicitly does NOT include this table in its allowlist.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_all ON app_users;
REVOKE ALL ON app_users FROM anon, authenticated;

COMMENT ON TABLE app_users IS
  'Platform sign-in accounts. Managed exclusively via /api/admin/users; '
  'never exposed through the /api/db catch-all proxy.';
