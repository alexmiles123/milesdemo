-- ============================================================================
-- MONUMENT — RLS SWEEP (defensive, idempotent)
--
-- Context: Supabase's security advisor flagged a public-schema table with
-- `rls_disabled_in_public`. Earlier migrations enable RLS on every table they
-- create, but a table created out-of-band (Supabase dashboard, ad-hoc SQL,
-- a migration that was edited after the table was already in place) can slip
-- through. This migration is the safety net.
--
-- What it does, for every base table in schema `public`:
--   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY
--   2. REVOKE ALL ... FROM anon, authenticated
--
-- The app talks to Supabase only through `/api/db/*` using SUPABASE_SERVICE_KEY,
-- which bypasses RLS. So locking everything down for anon/authenticated has no
-- effect on the app — it only closes the public PostgREST hole.
--
-- Re-running is safe: ENABLE ROW LEVEL SECURITY on a table that already has
-- it is a no-op, and REVOKE on already-revoked privileges is a no-op.
-- ============================================================================

DO $$
DECLARE
  t  RECORD;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
    EXECUTE format('REVOKE ALL ON %I.%I FROM anon, authenticated', t.schemaname, t.tablename);
  END LOOP;
END $$;

-- Default privileges: stop future tables from inheriting any anon/authenticated
-- grants. Without this, the next table created via the dashboard could re-open
-- the same hole this migration just closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Verification helper. Run this manually in the SQL editor after applying:
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = false;
-- An empty result means every public table now has RLS on.
