-- ============================================================================
-- MONUMENT — CUSTOMERS TABLE + BACKFILL (idempotent)
--
-- Replaces the plain-text `projects.customer` string field with a proper
-- `customers` table. Adds contact fields (primary contact name / email /
-- phone / mailing address) so the global account search + account detail
-- view have somewhere to live.
--
-- Strategy:
--   1. Create `customers` with the fields the UI needs.
--   2. Add `projects.customer_id` as a nullable FK (no data loss while
--      backfilling).
--   3. Seed rows from distinct non-null `projects.customer` strings.
--   4. Link each project to its customer by matching the trimmed name.
--   5. Keep `projects.customer` text in place for now — existing views/UIs
--      read it directly. The UI slowly migrates to joining on customer_id.
--
-- Safe to re-run: all creates are `IF NOT EXISTS` and the backfill steps use
-- `ON CONFLICT DO NOTHING` / conditional updates.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  address         TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Future-proof columns in case they were created in an earlier pass.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name  TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address       TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT true;

-- Name index for the global search. Prefer pg_trgm (fuzzy substring), fall
-- back to lower(name) if the extension can't be installed. Must try the
-- extension BEFORE the trigram index — gin_trgm_ops doesn't exist without it.
DO $$
DECLARE
  have_trgm BOOLEAN := false;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    have_trgm := true;
  EXCEPTION WHEN OTHERS THEN
    have_trgm := false;
  END;

  IF have_trgm THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops)';
  ELSE
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_name_lower ON customers (lower(name))';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Link projects to customers ------------------------------------------

ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_id UUID
  REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects(customer_id);

-- Seed customers from the distinct customer strings currently on projects.
INSERT INTO customers (name)
SELECT DISTINCT trim(customer)
FROM projects
WHERE customer IS NOT NULL AND trim(customer) <> ''
ON CONFLICT (name) DO NOTHING;

-- Point each project at its customer row (only where we haven't already).
UPDATE projects p
SET    customer_id = c.id
FROM   customers c
WHERE  p.customer_id IS NULL
  AND  p.customer IS NOT NULL
  AND  lower(trim(p.customer)) = lower(c.name);

-- --- Link customer_interactions to customers ------------------------------
-- Existing schema keys interactions off project_id only. That means a
-- customer with no projects can't own any activity rows (manual notes, etc).
-- Add a direct customer_id FK and backfill from the project.
ALTER TABLE customer_interactions
  ADD COLUMN IF NOT EXISTS customer_id UUID
  REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interactions_customer ON customer_interactions(customer_id);

UPDATE customer_interactions ci
SET    customer_id = p.customer_id
FROM   projects p
WHERE  ci.customer_id IS NULL
  AND  ci.project_id = p.id
  AND  p.customer_id IS NOT NULL;

-- --- RLS ------------------------------------------------------------------
-- Matches migration 005: RLS on, no permissive policies, access only via
-- service_role through the /api/db proxy.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_all ON customers;
REVOKE ALL ON customers FROM anon, authenticated;

COMMENT ON TABLE customers IS
  'Accounts/customers managed by the app. projects.customer_id FKs here. '
  'The legacy projects.customer text column is kept in sync by UI writes '
  'until all dashboards migrate to joining on customer_id.';
