-- ============================================================================
-- MONUMENT — CREATE alex.miles LOGIN AND LINK TO HIS CSM
-- One-shot script. Run in Supabase SQL Editor AFTER seed_alex_csm.sql.
--
-- Inserts an admin app_users row with:
--   username : alex.miles
--   email    : alexmiles123@gmail.com
--   role     : admin
--   password : Test123!Monument   <-- rotate from the UI after first login
--
-- The bcrypt hash below was generated with bcryptjs (cost 12), the same
-- library /api/auth/login uses to verify, so login will accept it.
--
-- Idempotent: ON CONFLICT updates the row in place.
-- ============================================================================

INSERT INTO app_users (username, email, full_name, password_hash, role, is_active, must_reset)
VALUES (
  'alex.miles',
  'alexmiles123@gmail.com',
  'Alex Miles',
  '$2b$12$X2lqx8hz0p8zMrKpc951n.gLs45zu2ppPUU75RooHC38Gd0fAiDn2',
  'admin',
  true,
  false
)
ON CONFLICT (username) DO UPDATE
  SET email         = EXCLUDED.email,
      full_name     = EXCLUDED.full_name,
      password_hash = EXCLUDED.password_hash,
      role          = EXCLUDED.role,
      is_active     = true,
      must_reset    = false,
      failed_attempts = 0,
      locked_until  = NULL,
      updated_at    = now();

-- Re-link to the CSM row (idempotent — safe even if seed_alex_csm ran first).
UPDATE app_users
SET    csm_id = c.id
FROM   csms c
WHERE  app_users.username = 'alex.miles'
  AND  c.email            = 'alexmiles123@gmail.com';

-- Verify.
SELECT au.id, au.username, au.email, au.role, au.is_active, au.csm_id,
       c.name AS csm_name, c.role AS csm_title
FROM   app_users au
LEFT   JOIN csms c ON c.id = au.csm_id
WHERE  au.username = 'alex.miles';
