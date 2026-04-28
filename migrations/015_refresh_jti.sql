-- ============================================================================
-- MONUMENT — REFRESH TOKEN ROTATION (idempotent)
--
-- Tracks every refresh-token jti the auth server has consumed. /api/auth/refresh
-- inserts the incoming jti before minting the next pair; the unique constraint
-- on `jti` makes a replay attempt (same token, used twice) a duplicate-key
-- failure that the handler turns into a forced sign-out.
--
-- Why a server-side table instead of in-memory: Vercel functions are stateless
-- and may run on different invocations; we need durable, cross-instance proof
-- that a token was already used.
--
-- Retention: rows older than the refresh TTL (30 days) are useless — the JWT
-- itself has already expired by then, so a stolen token couldn't verify even
-- without this table. The cleanup view + cron path below trims them.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_refresh_jti (
  jti          TEXT PRIMARY KEY,
  user_id      UUID,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_jti_consumed
  ON auth_refresh_jti (consumed_at);

ALTER TABLE auth_refresh_jti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_refresh_jti FROM anon, authenticated;

COMMENT ON TABLE auth_refresh_jti IS
  'Append-only ledger of consumed refresh-token JWT IDs. A duplicate insert '
  'on /api/auth/refresh is treated as a replay attack — the session is wiped.';

-- Helper for scheduled cleanup. Anything older than 35 days is well past the
-- 30-day refresh TTL and can be reaped with no security impact.
DROP VIEW IF EXISTS vw_auth_refresh_jti_expired CASCADE;
CREATE OR REPLACE VIEW vw_auth_refresh_jti_expired AS
  SELECT jti FROM auth_refresh_jti WHERE consumed_at < now() - INTERVAL '35 days';
