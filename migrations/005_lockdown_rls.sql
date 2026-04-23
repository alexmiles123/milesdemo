-- ============================================================================
-- MONUMENT — LOCK DOWN RLS (idempotent, reversible)
--
-- Context: every existing RLS policy on this schema was `USING (true)`,
-- which let anyone with the anon key read and write every table. The anon
-- key shipped in the React bundle, so that was equivalent to no security
-- at all.
--
-- New model:
--   * Frontend never holds the anon key. It calls `/api/db/<table>` with a
--     session JWT. The server verifies the JWT and forwards to Supabase
--     using SUPABASE_SERVICE_KEY.
--   * SUPABASE_SERVICE_KEY bypasses RLS entirely, so the app keeps working.
--   * anon + authenticated roles should have NO direct access — any leftover
--     credentials or direct PostgREST calls get zero rows.
--
-- Effect of this migration:
--   * Drops every `USING(true)` policy by name.
--   * Explicitly revokes table privileges from anon/authenticated.
--   * RLS stays enabled. With no policies, non-service-role roles see nothing.
--   * audit_log stays readable only via service_role; reads in the UI go
--     through `/api/db/audit_log` (GET only, the proxy blocks writes here).
-- ============================================================================

-- --- Drop permissive policies ---------------------------------------------

DROP POLICY IF EXISTS csms_all           ON csms;
DROP POLICY IF EXISTS projects_all       ON projects;
DROP POLICY IF EXISTS tasks_all          ON tasks;
DROP POLICY IF EXISTS assign_all         ON csm_assignments;
DROP POLICY IF EXISTS interactions_all   ON customer_interactions;
DROP POLICY IF EXISTS sync_runs_read     ON sync_runs;
DROP POLICY IF EXISTS integrations_service ON integrations;
DROP POLICY IF EXISTS notif_all          ON notification_rules;
DROP POLICY IF EXISTS csm_roles_all      ON csm_roles;
DROP POLICY IF EXISTS audit_read         ON audit_log;

-- These tables may or may not exist depending on which branch ran 001+.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capacity_entries') THEN
    EXECUTE 'DROP POLICY IF EXISTS capacity_all ON capacity_entries';
    EXECUTE 'DROP POLICY IF EXISTS capacity_entries_all ON capacity_entries';
    EXECUTE 'ALTER TABLE capacity_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON capacity_entries FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_commitments') THEN
    EXECUTE 'DROP POLICY IF EXISTS commitments_all ON project_commitments';
    EXECUTE 'DROP POLICY IF EXISTS project_commitments_all ON project_commitments';
    EXECUTE 'ALTER TABLE project_commitments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON project_commitments FROM anon, authenticated';
  END IF;
END $$;

-- --- Make sure RLS is enabled on every app table --------------------------

ALTER TABLE csms                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE csm_assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE csm_roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;

-- --- Revoke grants from non-service roles ---------------------------------
-- Even without policies, GRANTs can let anon hit the table. Strip them.

REVOKE ALL ON csms                  FROM anon, authenticated;
REVOKE ALL ON projects              FROM anon, authenticated;
REVOKE ALL ON tasks                 FROM anon, authenticated;
REVOKE ALL ON csm_assignments       FROM anon, authenticated;
REVOKE ALL ON customer_interactions FROM anon, authenticated;
REVOKE ALL ON sync_runs             FROM anon, authenticated;
REVOKE ALL ON integrations          FROM anon, authenticated;
REVOKE ALL ON notification_rules    FROM anon, authenticated;
REVOKE ALL ON csm_roles             FROM anon, authenticated;
REVOKE ALL ON audit_log             FROM anon, authenticated;

-- service_role continues to have full access (bypasses RLS and holds the
-- usual owner privileges granted by Supabase at project creation time).

COMMENT ON SCHEMA public IS
  'Monument app schema. All client traffic goes through /api/db/* using the '
  'service key. anon/authenticated roles have no table privileges — any '
  'PostgREST call with the anon key returns empty results or 401.';
