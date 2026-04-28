-- ============================================================================
-- 011_customer_project_fk.sql — wire projects to customers via a real FK.
--
-- Until now `projects.customer` was free text. That made adds/deletes drift:
-- deleting a project left orphan customers rows, and the consultant portal's
-- click-to-open-account flow was stub-creating customer records by name.
--
-- After this migration:
--   • projects.customer_id is the source of truth (FK → customers.id).
--   • projects.customer remains as a denormalized name cache so any view or
--     import path that still reads it keeps working — UI writes both.
--   • vw_portfolio joins through the FK and surfaces customer.name.
--
-- ON DELETE SET NULL is intentional: the UI never hard-deletes; it toggles
-- customers.is_active. The SET NULL is a safety net if a row is removed
-- directly in Supabase.
-- ============================================================================

-- 1. Backfill any orphan customer names into customers (case-insensitive dedupe).
INSERT INTO customers (name)
SELECT DISTINCT TRIM(p.customer)
FROM projects p
WHERE p.customer IS NOT NULL
  AND TRIM(p.customer) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM customers c WHERE LOWER(c.name) = LOWER(TRIM(p.customer))
  )
ON CONFLICT (name) DO NOTHING;

-- 2. Add the FK column.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- 3. Backfill projects.customer_id from name match.
UPDATE projects p
SET customer_id = c.id
FROM customers c
WHERE p.customer_id IS NULL
  AND p.customer IS NOT NULL
  AND LOWER(c.name) = LOWER(TRIM(p.customer));

-- 4. Index for the join in vw_portfolio + the "projects under this customer"
--    query CustomersTab issues.
CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects (customer_id);

-- 5. Refresh vw_portfolio so customer name is sourced from the customers
--    table when an FK is set, falling back to the legacy text column for any
--    pre-migration project that never got a match.
DROP VIEW IF EXISTS vw_portfolio CASCADE;
CREATE OR REPLACE VIEW vw_portfolio AS
SELECT
  p.id,
  p.name,
  COALESCE(c.name, p.customer, p.name) AS customer,
  p.customer_id,
  p.csm_id,
  csm.name AS csm,
  p.stage,
  p.arr,
  p.health,
  COALESCE(p.health_label,
    CASE p.health WHEN 'green' THEN 'On Track' WHEN 'yellow' THEN 'At Risk' ELSE 'Critical' END
  ) AS health_label,
  p.target_date,
  p.completion_pct,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'complete') AS tasks_complete,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'upcoming') AS tasks_upcoming,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'late') AS tasks_late
FROM projects p
LEFT JOIN customers c ON c.id = p.customer_id
LEFT JOIN csms csm ON csm.id = p.csm_id;
