-- ============================================================================
-- MONUMENT PS OPERATIONS — BASE SCHEMA (idempotent)
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- Previously the csms / projects / tasks tables lived only in Supabase. This
-- file makes the schema reproducible from git. Existing rows are preserved.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── CSMs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'CSM',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csms_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_csms_active ON csms(is_active) WHERE is_active = true;

-- ─── PROJECTS (customer accounts) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  customer        TEXT,
  csm_id          UUID REFERENCES csms(id) ON DELETE SET NULL,
  stage           TEXT NOT NULL DEFAULT 'Kickoff'
                    CHECK (stage IN ('Kickoff','Discovery','Implementation','Testing & QA','Go-Live Prep','Go-Live')),
  health          TEXT NOT NULL DEFAULT 'green'
                    CHECK (health IN ('green','yellow','red')),
  health_label    TEXT,
  arr             NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_date     DATE,
  completion_pct  INT NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  external_ids    JSONB NOT NULL DEFAULT '{}'::jsonb, -- salesforce/teams/etc
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_csm ON projects(csm_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);
CREATE INDEX IF NOT EXISTS idx_projects_health ON projects(health);

-- ─── TASKS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'Kickoff',
  priority         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('critical','high','medium','low')),
  status           TEXT NOT NULL DEFAULT 'upcoming'
                     CHECK (status IN ('complete','upcoming','late')),
  proj_date        DATE,
  actual_date      DATE,
  assignee_type    TEXT,
  assignee_name    TEXT,
  notes            TEXT,
  estimated_hours  NUMERIC(5,1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_proj_date ON tasks(proj_date);

-- ─── VIEWS used by the dashboard ────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_portfolio AS
SELECT
  p.id,
  p.name,
  COALESCE(p.customer, p.name) AS customer,
  p.csm_id,
  c.name AS csm,
  p.stage,
  p.arr,
  p.health,
  COALESCE(p.health_label,
    CASE p.health WHEN 'green' THEN 'On Track' WHEN 'yellow' THEN 'At Risk' ELSE 'Critical' END
  ) AS health_label,
  p.target_date,
  p.completion_pct,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'complete') AS tasks_complete,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'upcoming') AS tasks_upcoming,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'late') AS tasks_late
FROM projects p
LEFT JOIN csms c ON c.id = p.csm_id;

CREATE OR REPLACE VIEW vw_csm_scorecard AS
SELECT
  c.id         AS csm_id,
  c.name       AS csm,
  count(p.id)  AS total_accounts,
  COALESCE(sum(p.arr), 0) AS total_arr,
  (SELECT count(*) FROM tasks t JOIN projects p2 ON p2.id = t.project_id
     WHERE p2.csm_id = c.id AND t.status = 'late') AS late_tasks
FROM csms c
LEFT JOIN projects p ON p.csm_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.name;

-- ─── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_csms_updated     ON csms;
DROP TRIGGER IF EXISTS trg_projects_updated ON projects;
DROP TRIGGER IF EXISTS trg_tasks_updated    ON tasks;

CREATE TRIGGER trg_csms_updated     BEFORE UPDATE ON csms     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated    BEFORE UPDATE ON tasks    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE csms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csms_all     ON csms;
DROP POLICY IF EXISTS projects_all ON projects;
DROP POLICY IF EXISTS tasks_all    ON tasks;

CREATE POLICY csms_all     ON csms     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY projects_all ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY tasks_all    ON tasks    FOR ALL USING (true) WITH CHECK (true);
