-- Add renewal_date to customers, and allow account-level file attachments.
--
-- project_attachments currently requires project_id NOT NULL — we relax that
-- so a file can be scoped to a customer directly (account-level docs, contracts,
-- etc.) without being tied to a specific project. The new scope_check constraint
-- ensures every row is still pinned to at least one of project or customer.

BEGIN;

-- Renewal date on customer records (visible in Summary KPI + Profile tab)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS renewal_date DATE;

-- Allow project_id to be NULL when uploading account-level files
ALTER TABLE project_attachments ALTER COLUMN project_id DROP NOT NULL;

-- Add customer_id so files can be scoped to an account directly
ALTER TABLE project_attachments
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE CASCADE;

-- Every attachment must belong to a project OR a customer (or both)
ALTER TABLE project_attachments
  ADD CONSTRAINT project_attachments_scope_check
    CHECK (project_id IS NOT NULL OR customer_id IS NOT NULL);

COMMIT;
