-- ============================================================================
-- MONUMENT — PASSWORD POLICY (idempotent)
--
-- Single-row table that holds the password rules enforced by both the server
-- (api/admin/users.js, /api/auth/*) and the client (CSM + User modals). Was
-- previously hardcoded in three places; moving it to the database lets an
-- admin tune it from the Security tab without a deploy.
--
-- Why a single-row table instead of a key/value `app_settings`:
--   * Strongly-typed columns (no JSON casting) so the validator stays trivial
--   * The `id = 1` check guarantees the helper never returns ambiguous rows
--   * Easy to extend later (rotation_days, history_count, etc.) by adding
--     columns rather than untyped keys
--
-- Defaults match the policy that was hardcoded prior to this migration so
-- existing accounts continue to satisfy validation. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS password_policy (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  min_length      INT     NOT NULL DEFAULT 12 CHECK (min_length >= 8 AND min_length <= 128),
  require_upper   BOOLEAN NOT NULL DEFAULT true,
  require_lower   BOOLEAN NOT NULL DEFAULT true,
  require_number  BOOLEAN NOT NULL DEFAULT true,
  require_symbol  BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  CONSTRAINT password_policy_single_row CHECK (id = 1)
);

INSERT INTO password_policy (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_password_policy_updated ON password_policy;
CREATE TRIGGER trg_password_policy_updated BEFORE UPDATE ON password_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Same posture as app_users: never expose through the /api/db catch-all.
-- Reads + writes go through /api/password-policy (read = any signed-in user
-- so the login/reset screens can show requirements; write = admin only).
ALTER TABLE password_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_policy FROM anon, authenticated;

COMMENT ON TABLE password_policy IS
  'Single-row config for password complexity rules. Edit via the Security '
  'tab; never written from the /api/db proxy.';
