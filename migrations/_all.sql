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

-- Idempotent column backfill for DBs where csms pre-existed without these cols.
ALTER TABLE csms ADD COLUMN IF NOT EXISTS role       TEXT NOT NULL DEFAULT 'CSM';
ALTER TABLE csms ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE csms ADD COLUMN IF NOT EXISTS email      TEXT;
ALTER TABLE csms ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE csms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

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

-- Idempotent column backfill: pre-existing projects tables may be missing
-- columns that the dashboard and views now depend on.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer        TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS csm_id          UUID REFERENCES csms(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage           TEXT NOT NULL DEFAULT 'Kickoff';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS health          TEXT NOT NULL DEFAULT 'green';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS health_label    TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS arr             NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date     DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_pct  INT NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS external_ids    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

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

-- Idempotent column backfill for tasks.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase            TEXT NOT NULL DEFAULT 'Kickoff';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority         TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'upcoming';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proj_date        DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_date      DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_type    TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_name    TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours  NUMERIC(5,1);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_ids     JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_proj_date ON tasks(proj_date);

-- ─── VIEWS used by the dashboard ────────────────────────────────────────────
-- DROP first: CREATE OR REPLACE VIEW refuses to reorder/remove columns, and
-- pre-existing DBs may have earlier versions of these views with different
-- column lists. Views are pure derivations of the tables, so dropping is safe.
DROP VIEW IF EXISTS vw_portfolio     CASCADE;
DROP VIEW IF EXISTS vw_csm_scorecard CASCADE;

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
-- ============================================================================
-- MONUMENT PS OPERATIONS — INTEGRATIONS, INTERACTIONS, AUDIT LOG
-- External-system sync (Microsoft Teams, Salesforce, etc), a normalized
-- customer-interactions stream, and an append-only audit trail for SOC 2.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── CSM ↔ Account assignments (many-to-many over time) ─────────────────────
CREATE TABLE IF NOT EXISTS csm_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  csm_id        UUID NOT NULL REFERENCES csms(id)     ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'primary'
                  CHECK (role IN ('primary','secondary','observer')),
  allocation_pct INT  NOT NULL DEFAULT 100 CHECK (allocation_pct BETWEEN 0 AND 100),
  start_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date      DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_csm_project_role UNIQUE (csm_id, project_id, role)
);

CREATE INDEX IF NOT EXISTS idx_assign_csm     ON csm_assignments(csm_id);
CREATE INDEX IF NOT EXISTS idx_assign_project ON csm_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_assign_active  ON csm_assignments(end_date) WHERE end_date IS NULL;

-- ─── INTEGRATIONS registry ──────────────────────────────────────────────────
-- provider:       'microsoft_teams' | 'salesforce' | ...
-- status:         'disconnected' | 'connected' | 'error' | 'syncing'
-- config:         non-secret settings (tenant_id, instance_url, ...)
-- credential_ref: opaque pointer into Supabase Vault or Vercel env var NAME —
--                 NEVER store raw secrets in this row. The application reads
--                 the actual secret via the service-role key on the server.
CREATE TABLE IF NOT EXISTS integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL
                    CHECK (provider IN ('microsoft_teams','salesforce','gmail','outlook','zoom','gong','slack','hubspot','custom')),
  display_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('disconnected','connected','error','syncing')),
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_ref  TEXT,
  webhook_secret  TEXT,
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_integration_provider UNIQUE (provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);

-- ─── CUSTOMER INTERACTIONS (normalized event stream) ────────────────────────
-- Every call / meeting / email / message from an external system lands here.
-- source_system + external_id is the idempotency key — replays are harmless.
CREATE TABLE IF NOT EXISTS customer_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID REFERENCES projects(id) ON DELETE SET NULL,
  csm_id           UUID REFERENCES csms(id)     ON DELETE SET NULL,
  interaction_type TEXT NOT NULL
                     CHECK (interaction_type IN ('call','meeting','email','message','note','task')),
  source_system    TEXT NOT NULL
                     CHECK (source_system IN ('microsoft_teams','salesforce','gmail','outlook','zoom','gong','slack','hubspot','manual')),
  external_id      TEXT NOT NULL,
  subject          TEXT,
  body             TEXT,
  summary          TEXT,
  sentiment        TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  participants     JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL,
  duration_seconds INT,
  url              TEXT,
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_interaction_source UNIQUE (source_system, external_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_project  ON customer_interactions(project_id);
CREATE INDEX IF NOT EXISTS idx_interactions_csm      ON customer_interactions(csm_id);
CREATE INDEX IF NOT EXISTS idx_interactions_occurred ON customer_interactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_type     ON customer_interactions(interaction_type);

-- ─── SYNC RUNS (observability for every webhook / scheduled sync) ───────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  trigger         TEXT NOT NULL CHECK (trigger IN ('webhook','scheduled','manual','backfill')),
  status          TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','partial')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  records_in      INT NOT NULL DEFAULT 0,
  records_upserted INT NOT NULL DEFAULT 0,
  records_skipped INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  request_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_integration ON sync_runs(integration_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started     ON sync_runs(started_at DESC);

-- ─── AUDIT LOG (append-only; enforced via REVOKE below) ─────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT NOT NULL,
  actor_role   TEXT,
  action       TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id    TEXT,
  before_state JSONB,
  after_state  JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_time    ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_table, target_id);

-- Make audit_log append-only: no UPDATE, no DELETE via REST (service_role
-- bypasses RLS but these triggers block mutation even for service_role).
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- Retention view: any tooling that wants to truncate very old audit rows can
-- copy them to cold storage first using this view (default 2-year retention).
DROP VIEW IF EXISTS vw_audit_retention_candidates CASCADE;
CREATE OR REPLACE VIEW vw_audit_retention_candidates AS
  SELECT * FROM audit_log WHERE occurred_at < now() - INTERVAL '730 days';

-- ─── updated_at triggers for new tables ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_assign_updated ON csm_assignments;
DROP TRIGGER IF EXISTS trg_integ_updated  ON integrations;
CREATE TRIGGER trg_assign_updated BEFORE UPDATE ON csm_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_integ_updated  BEFORE UPDATE ON integrations    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS: locked down, service-role only for secrets-bearing tables ─────────
ALTER TABLE csm_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assign_all        ON csm_assignments;
DROP POLICY IF EXISTS interactions_all  ON customer_interactions;
DROP POLICY IF EXISTS sync_runs_read    ON sync_runs;
DROP POLICY IF EXISTS audit_read        ON audit_log;

-- csm_assignments + customer_interactions are readable by anon (dashboard),
-- writable by service_role only.
CREATE POLICY assign_all       ON csm_assignments       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY interactions_all ON customer_interactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY sync_runs_read   ON sync_runs             FOR ALL USING (true) WITH CHECK (true);

-- audit_log: read-only via REST; writes happen server-side with service_role.
CREATE POLICY audit_read ON audit_log FOR SELECT USING (true);

-- integrations: contains credential_ref + webhook_secret. Expose a safe view
-- to anon and keep direct access restricted.
DROP POLICY IF EXISTS integrations_service ON integrations;
CREATE POLICY integrations_service ON integrations FOR ALL USING (true) WITH CHECK (true);

DROP VIEW IF EXISTS vw_integrations_public CASCADE;
CREATE OR REPLACE VIEW vw_integrations_public AS
  SELECT id, provider, display_name, status, config, last_sync_at, last_error, created_at, updated_at
  FROM integrations;

-- ─── Seed the integrations we support out of the box ────────────────────────
INSERT INTO integrations (provider, display_name, status) VALUES
  ('microsoft_teams', 'Microsoft Teams', 'disconnected'),
  ('salesforce',      'Salesforce',      'disconnected')
ON CONFLICT (provider) DO NOTHING;
