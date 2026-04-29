-- ============================================================================
-- WIPE ALL PROJECTS, CUSTOMERS, AND RELATED DATA
-- Deletes: tasks, notes, attachments, assignments, interactions, projects,
--          customers, and their audit log entries.
-- Keeps:   csms, users, templates, phases, integrations, notification rules.
-- Run manually in the Supabase SQL Editor. NOT run by apply-migrations.sh.
-- ============================================================================

TRUNCATE
  project_attachments,
  project_notes,
  tasks,
  csm_assignments,
  customer_interactions,
  projects,
  customers
  RESTART IDENTITY CASCADE;
