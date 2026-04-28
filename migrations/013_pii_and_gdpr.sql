-- ============================================================================
-- MONUMENT — PII PROTECTION + GDPR SUPPORT (idempotent)
--
-- Two pieces:
--
-- 1. Enable pgcrypto so application-level encryption helpers (api/_lib/pii.js)
--    have a database-side counterpart for any future column-level encryption
--    work. We do not migrate any columns to pgcrypto yet — Supabase's at-rest
--    disk encryption already covers the common "stolen backup tape" threat.
--    What this enables is *column-level* encryption keyed by a secret the
--    database operator does not hold (PII_ENCRYPTION_KEY env var), for
--    columns that need it later (free-text customer notes, etc.).
--
-- 2. A `gdpr_deletions` log so we can prove, on request, that a subject's
--    data was scrubbed. Soft-delete by anonymization rather than hard delete:
--    audit_log rows must remain intact for SOC 2, so we replace the personal
--    fields with deterministic placeholders and append a row here recording
--    when, by whom, and what was scrubbed.
--
-- Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS gdpr_deletions (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT NOT NULL,                 -- admin who actioned the request
  subject_kind  TEXT NOT NULL,                 -- 'app_user' | 'csm' | 'customer'
  subject_id    TEXT NOT NULL,                 -- the row id that was scrubbed
  subject_email TEXT,                          -- for cross-system reconciliation
  scrubbed_fields JSONB NOT NULL DEFAULT '{}', -- { col: true } per touched column
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS gdpr_deletions_occurred_at_idx ON gdpr_deletions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS gdpr_deletions_subject_idx     ON gdpr_deletions (subject_kind, subject_id);

ALTER TABLE gdpr_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gdpr_deletions FROM anon, authenticated;

COMMENT ON TABLE gdpr_deletions IS
  'Append-only log of GDPR / CCPA subject-deletion requests. The original '
  'PII columns are anonymized in place; this table records what was changed '
  'so we can prove compliance on audit.';
