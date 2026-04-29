-- ============================================================================
-- MONUMENT — WIPE ALL DATA (keeps schema, keeps integration seed rows)
-- Run this in the Supabase SQL Editor when you want a clean slate.
-- This is NOT run by scripts/apply-migrations.sh — you must run it manually.
-- ============================================================================

-- Tables with user data → truncated.
-- CASCADE handles FK chains (projects → tasks/notes/attachments/csm_assignments,
-- customers → interactions, etc).
-- audit_log has a trigger blocking UPDATE/DELETE, but TRUNCATE is a separate
-- operation and is NOT blocked by that trigger.
-- Hard delete: rows are removed, not flagged inactive.
TRUNCATE
  project_notes,
  project_attachments,
  tasks,
  csm_assignments,
  customer_interactions,
  sync_runs,
  projects,
  customers,
  csms,
  audit_log
  RESTART IDENTITY CASCADE;

-- Integrations: keep the seed rows (Teams + Salesforce) so the UI still lists
-- them, but reset all connection state. Re-configure through the UI after.
UPDATE integrations SET
  status         = 'disconnected',
  config         = '{}'::jsonb,
  credential_ref = NULL,
  webhook_secret = NULL,
  last_sync_at   = NULL,
  last_error     = NULL;

-- Notification rules: wipe recipient lists (if the table exists — migration
-- 003 creates it). Keeps the event-type seed rows and their enabled flags.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_rules') THEN
    EXECUTE 'UPDATE notification_rules SET to_recipients = ''{}''::text[], cc_recipients = ''{}''::text[]';
  END IF;
END $$;
