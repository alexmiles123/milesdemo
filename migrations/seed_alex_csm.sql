-- ============================================================================
-- MONUMENT — SEED ALEX MILES AS A CSM AND LINK TO HIS LOGIN
-- One-shot script. Run in Supabase SQL Editor.
--
-- 1. Inserts a csms row for "Alex Miles" (Vice President-CS).
-- 2. Links the existing app_users login (matched by email) to that csms row
--    via app_users.csm_id, so /api/db's per-row authz can scope writes.
--
-- Idempotent: uses ON CONFLICT on the unique email, so re-running this
-- won't duplicate the CSM row.
-- ============================================================================

INSERT INTO csms (name, email, role, is_active)
VALUES ('Alex Miles', 'alexmiles123@gmail.com', 'Vice President- CS', true)
ON CONFLICT (email) DO UPDATE
  SET name      = EXCLUDED.name,
      role      = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      updated_at = now();

-- Link the login to the CSM row. Match on email since usernames may differ
-- across environments (alex.miles, alexmiles, etc.).
UPDATE app_users
SET    csm_id = c.id
FROM   csms c
WHERE  app_users.email = 'alexmiles123@gmail.com'
  AND  c.email         = 'alexmiles123@gmail.com';

-- Verify (returns the joined row so you can sanity-check the link).
SELECT au.id        AS user_id,
       au.username,
       au.email,
       au.role      AS app_role,
       au.csm_id,
       c.id         AS csm_row_id,
       c.name       AS csm_name,
       c.role       AS csm_title
FROM   app_users au
LEFT   JOIN csms c ON c.id = au.csm_id
WHERE  au.email = 'alexmiles123@gmail.com';
