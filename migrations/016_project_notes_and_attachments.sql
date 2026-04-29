-- ============================================================================
-- MONUMENT — PROJECT NOTES + ATTACHMENTS (idempotent)
--
-- Adds the two pieces every PSA tool needs around its project record:
--
--   1. project_notes — a chronological log of CSM commentary on a project.
--      Distinct from `customer_interactions` (which logs touchpoints with the
--      customer) and from `tasks.notes` (single inline string per task). This
--      is the "Notes" tab on the project page.
--
--   2. project_attachments — file references for a project, optionally pinned
--      to a phase or a task. Files themselves live in Supabase Storage; this
--      table stores the metadata so a delete can clean up both.
--
-- Both tables carry csm_id so the existing dbAuthz.js policy (csm-role users
-- can only read/write rows they own) extends to them with no app changes.
--
-- Storage: a private bucket named `project-files` is required. We try to
-- create it here, but the extension is only present on Supabase-hosted
-- Postgres — a self-hosted run will skip the storage block silently.
--
-- Safe to re-run.
-- ============================================================================

-- ─── PROJECT NOTES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csm_id      UUID REFERENCES csms(id) ON DELETE SET NULL,
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_task    ON project_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_created ON project_notes(created_at DESC);

ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_notes FROM anon, authenticated;

COMMENT ON TABLE project_notes IS
  'Free-form notes a CSM writes on a project (or a specific task) — visible '
  'on the project detail page. Service-role only; routed through /api/db.';

-- ─── PROJECT ATTACHMENTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csm_id        UUID REFERENCES csms(id) ON DELETE SET NULL,
  task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL,
  phase         TEXT,
  file_name     TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  mime_type     TEXT,
  size_bytes    BIGINT,
  uploaded_by   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_project ON project_attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_task    ON project_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_phase   ON project_attachments(phase);

ALTER TABLE project_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_attachments FROM anon, authenticated;

COMMENT ON TABLE project_attachments IS
  'Metadata for files uploaded against a project. Bytes live in the '
  'project-files Storage bucket; the storage_path is what /api/files signs '
  'a download URL for.';

-- ─── STORAGE BUCKET ─────────────────────────────────────────────────────────
-- Only runs if the storage extension is present (i.e. on Supabase-managed
-- Postgres). Self-hosted skips this block; create the bucket via the
-- Storage UI in that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('project-files', 'project-files', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
