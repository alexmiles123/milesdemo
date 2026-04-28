-- ============================================================================
-- MONUMENT — CLAUDE API SPEND CAP (idempotent)
--
-- The /api/claude proxy forwards authenticated requests to Anthropic using a
-- single workspace key. Without a budget, a compromised account or a runaway
-- client loop can mint a five-figure invoice in an afternoon. Two tables:
--
--   • claude_usage   — append-only log of every successful Anthropic call.
--                      Stored at the prompt level (not aggregated) so we can
--                      attribute spend by user and time-bucket the spend cap
--                      check without scanning the whole table.
--
--   • claude_budget  — single-row monthly cap (USD cents, integer to avoid
--                      float drift). Admins edit via /api/admin/* later;
--                      the proxy reads via api/_lib/sb.js.
--
-- The spend gate compares SUM(cost_usd_cents) for the current month against
-- claude_budget.monthly_cap_cents and 429s when over. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claude_usage (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT,
  actor_role    TEXT,
  model         TEXT NOT NULL,
  input_tokens  INT  NOT NULL DEFAULT 0,
  output_tokens INT  NOT NULL DEFAULT 0,
  cost_usd_cents INT NOT NULL DEFAULT 0,
  request_id    TEXT,
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS claude_usage_occurred_at_idx ON claude_usage (occurred_at DESC);
CREATE INDEX IF NOT EXISTS claude_usage_actor_idx       ON claude_usage (actor);

CREATE TABLE IF NOT EXISTS claude_budget (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  monthly_cap_cents  INT     NOT NULL DEFAULT 50000,    -- $500/mo
  per_user_cap_cents INT     NOT NULL DEFAULT 10000,    -- $100/mo
  enabled            BOOLEAN NOT NULL DEFAULT true,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT,
  CONSTRAINT claude_budget_single_row CHECK (id = 1)
);

INSERT INTO claude_budget (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_claude_budget_updated ON claude_budget;
CREATE TRIGGER trg_claude_budget_updated BEFORE UPDATE ON claude_budget
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Locked down. Reads/writes happen through server-side code with the service
-- key; never expose through the /api/db catch-all.
ALTER TABLE claude_usage  ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON claude_usage  FROM anon, authenticated;
REVOKE ALL ON claude_budget FROM anon, authenticated;

COMMENT ON TABLE claude_usage  IS 'Append-only log of Anthropic Messages API calls — used for spend caps and per-user attribution.';
COMMENT ON TABLE claude_budget IS 'Single-row monthly USD cap on Anthropic spend. Edited by admins via /api/admin/* paths only.';
