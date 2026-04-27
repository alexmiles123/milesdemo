-- ============================================================================
-- MONUMENT — TASK TEMPLATES (idempotent)
--
-- Lets an admin pre-define a list of tasks (e.g. "Standard Onboarding",
-- "Enterprise Implementation") that are stamped onto a new project at
-- creation time. Saves the CSM from rebuilding the same checklist for
-- every new account.
--
-- Design:
--   • task_templates       — header row (name, description, default flag)
--   • task_template_items  — the rows that get expanded into `tasks` when
--                             a template is applied. Keeps `phase`,
--                             `priority`, `estimated_hours`, and a relative
--                             `day_offset` (added to project start_date /
--                             today to compute proj_date on apply).
--
-- The application step is performed server-side in /api/admin/apply-template
-- so we can do it in one transaction and audit-log it.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_task_templates_updated ON task_templates;
CREATE TRIGGER trg_task_templates_updated BEFORE UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS task_template_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  sort_order       INT NOT NULL DEFAULT 0,
  name             TEXT NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'Kickoff',
  priority         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('critical','high','medium','low')),
  estimated_hours  NUMERIC(5,1),
  day_offset       INT NOT NULL DEFAULT 0,           -- days from project start_date
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_items_tpl ON task_template_items(template_id, sort_order);

-- Only one template can be the default at a time. Enforce via partial unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_templates_default
  ON task_templates ((true)) WHERE is_default = true;

-- RLS — same pattern as the rest of the app: locked down except via service key.
ALTER TABLE task_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_template_items  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_templates_all      ON task_templates;
DROP POLICY IF EXISTS task_template_items_all ON task_template_items;
REVOKE ALL ON task_templates       FROM anon, authenticated;
REVOKE ALL ON task_template_items  FROM anon, authenticated;

-- ─── Seed: a sane default template the demo can use out of the box ─────────
-- Idempotent: only seeded if no templates exist yet.
DO $$
DECLARE tpl_id UUID;
BEGIN
  IF (SELECT COUNT(*) FROM task_templates) = 0 THEN
    INSERT INTO task_templates (name, description, is_default)
    VALUES ('Standard Onboarding',
            'Default checklist applied to new customer projects. Covers the full kickoff → go-live arc.',
            true)
    RETURNING id INTO tpl_id;

    INSERT INTO task_template_items (template_id, sort_order, name, phase, priority, estimated_hours, day_offset) VALUES
      (tpl_id,  1, 'Internal kickoff & resourcing',          'Kickoff',         'high',    2.0,  0),
      (tpl_id,  2, 'External kickoff call with customer',    'Kickoff',         'critical',1.5,  3),
      (tpl_id,  3, 'Discovery workshop',                      'Discovery',       'high',    4.0,  10),
      (tpl_id,  4, 'Statement of work + scope sign-off',     'Discovery',       'critical',2.0,  17),
      (tpl_id,  5, 'Configure environment',                  'Implementation',  'high',    8.0,  21),
      (tpl_id,  6, 'Data load + validation',                 'Implementation',  'high',    6.0,  28),
      (tpl_id,  7, 'Integration setup',                       'Implementation',  'medium',  4.0,  35),
      (tpl_id,  8, 'UAT script + customer test plan',         'Testing & QA',    'high',    3.0,  42),
      (tpl_id,  9, 'User acceptance testing',                 'Testing & QA',    'critical',6.0,  49),
      (tpl_id, 10, 'Training sessions',                       'Go-Live Prep',    'high',    4.0,  56),
      (tpl_id, 11, 'Go-live readiness review',                'Go-Live Prep',    'critical',2.0,  60),
      (tpl_id, 12, 'Go-live cutover',                          'Go-Live',         'critical',3.0,  63),
      (tpl_id, 13, 'Hypercare check-in (week 1)',             'Go-Live',         'high',    1.0,  70);
  END IF;
END $$;

COMMENT ON TABLE task_templates IS
  'Reusable task lists applied to new projects. Managed via /api/admin/templates.';
