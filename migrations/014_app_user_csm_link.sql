-- ============================================================================
-- MONUMENT — APP USER ↔ CSM LINK (idempotent)
--
-- Adds a nullable FK from app_users to csms so a sign-in account can be
-- pinned to a specific CSM record. Required for per-row authorization in the
-- /api/db proxy: when a `csm`-role user logs in, the JWT carries their
-- csm_id, and the proxy injects `csm_id=eq.<id>` filters on writes so a CSM
-- can only mutate rows they own.
--
-- ON DELETE SET NULL — deleting a CSM should not also delete their login
-- account (an admin can re-link or deactivate it).
--
-- Safe to re-run.
-- ============================================================================

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS csm_id UUID REFERENCES csms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_csm_id ON app_users(csm_id);

COMMENT ON COLUMN app_users.csm_id IS
  'Optional link to the csms row this login represents. Drives per-row '
  'authorization in the /api/db proxy for users with role=csm.';
