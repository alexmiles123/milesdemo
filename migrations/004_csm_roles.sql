-- ============================================================================
-- MONUMENT — CSM ROLES LOOKUP (idempotent)
-- Replaces the hardcoded ROLE_OPTIONS array in src/lib/theme.js with a
-- database-managed lookup table so admins can add/rename/disable roles
-- through the UI without a code deploy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS csm_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  sort_order INT  NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csm_roles_sort ON csm_roles(sort_order);

DROP TRIGGER IF EXISTS trg_csm_roles_updated ON csm_roles;
CREATE TRIGGER trg_csm_roles_updated BEFORE UPDATE ON csm_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE csm_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS csm_roles_all ON csm_roles;
CREATE POLICY csm_roles_all ON csm_roles FOR ALL USING (true) WITH CHECK (true);

-- Seed with the values that used to live in src/lib/theme.js. Safe to re-run.
INSERT INTO csm_roles (name, sort_order) VALUES
  ('CSM',         10),
  ('Senior CSM',  20),
  ('Lead CSM',    30),
  ('CSM Manager', 40),
  ('Director',    50)
ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE csm_roles IS
  'Lookup for CSM role titles. The CsmsTab UI loads active rows here to populate the role dropdown.';
