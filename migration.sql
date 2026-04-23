-- ============================================================================
-- MONUMENT PS OPERATIONS — CAPACITY FORECASTING MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. CAPACITY ENTRIES TABLE
-- Stores each CSM's available hours per week (default 40)
CREATE TABLE IF NOT EXISTS capacity_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  csm_id UUID NOT NULL REFERENCES csms(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  estimated_hours NUMERIC(5,1) NOT NULL DEFAULT 40,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one entry per CSM per week
  CONSTRAINT uq_capacity_csm_week UNIQUE (csm_id, week_start_date),
  -- Week must start on Monday (DOW 1 in PostgreSQL)
  CONSTRAINT chk_week_monday CHECK (EXTRACT(ISODOW FROM week_start_date) = 1)
);

CREATE INDEX IF NOT EXISTS idx_capacity_csm ON capacity_entries(csm_id);
CREATE INDEX IF NOT EXISTS idx_capacity_week ON capacity_entries(week_start_date);

-- 2. PROJECT COMMITMENTS TABLE
-- Manual commitment blocks (client calls, travel, onboarding, etc.)
CREATE TABLE IF NOT EXISTS project_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  csm_id UUID NOT NULL REFERENCES csms(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  estimated_hours NUMERIC(5,1) NOT NULL DEFAULT 2,
  commitment_type TEXT NOT NULL DEFAULT 'Meeting',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Week must start on Monday
  CONSTRAINT chk_commit_week_monday CHECK (EXTRACT(ISODOW FROM week_start_date) = 1)
);

CREATE INDEX IF NOT EXISTS idx_commit_csm ON project_commitments(csm_id);
CREATE INDEX IF NOT EXISTS idx_commit_week ON project_commitments(week_start_date);
CREATE INDEX IF NOT EXISTS idx_commit_project ON project_commitments(project_id);

-- ============================================================================
-- 3. SEED DATA — Capacity Entries (16 weeks: 4 past + 12 future)
-- ============================================================================

INSERT INTO capacity_entries (csm_id, week_start_date, estimated_hours, notes)
SELECT
  c.id,
  ws::date,
  CASE
    -- Week 3 future: one CSM has PTO
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 14 AND c.name = (SELECT name FROM csms WHERE is_active = true ORDER BY name LIMIT 1)
      THEN 24
    -- Week 6 future: another CSM has reduced
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 35 AND c.name = (SELECT name FROM csms WHERE is_active = true ORDER BY name LIMIT 1 OFFSET 1)
      THEN 32
    -- Week 8: conference week
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 49
      THEN 32
    ELSE 40
  END,
  CASE
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 14 AND c.name = (SELECT name FROM csms WHERE is_active = true ORDER BY name LIMIT 1)
      THEN 'PTO - partial week'
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 35 AND c.name = (SELECT name FROM csms WHERE is_active = true ORDER BY name LIMIT 1 OFFSET 1)
      THEN 'Working from conference'
    WHEN ws = date_trunc('week', CURRENT_DATE)::date + 49
      THEN 'Team offsite - reduced availability'
    ELSE NULL
  END
FROM csms c
CROSS JOIN generate_series(
  date_trunc('week', CURRENT_DATE)::date - 28,
  date_trunc('week', CURRENT_DATE)::date + 77,
  7
) ws
WHERE c.is_active = true
ON CONFLICT (csm_id, week_start_date) DO NOTHING;

-- ============================================================================
-- 4. SEED DATA — Project Commitments (sample manual blocks)
-- ============================================================================

-- Client calls for active projects (2h each, spread over next 6 weeks)
INSERT INTO project_commitments (project_id, csm_id, week_start_date, estimated_hours, commitment_type, notes)
SELECT
  p.id,
  p.csm_id,
  date_trunc('week', CURRENT_DATE)::date + (s.n * 7),
  2,
  'Client Call',
  'Weekly sync with ' || p.name || ' stakeholders'
FROM projects p
CROSS JOIN (SELECT generate_series(0, 5) AS n) s
WHERE p.stage IN ('Kickoff', 'Discovery', 'Implementation', 'Testing & QA')
  AND p.csm_id IS NOT NULL;

-- Onboarding sessions for Kickoff/Discovery projects (4h, weeks 1-3)
INSERT INTO project_commitments (project_id, csm_id, week_start_date, estimated_hours, commitment_type, notes)
SELECT
  p.id,
  p.csm_id,
  date_trunc('week', CURRENT_DATE)::date + (s.n * 7),
  4,
  'Onboarding Session',
  'User onboarding session for ' || p.name
FROM projects p
CROSS JOIN (SELECT generate_series(1, 3) AS n) s
WHERE p.stage IN ('Kickoff', 'Discovery')
  AND p.csm_id IS NOT NULL;

-- Travel for Go-Live Prep projects (8h blocks, weeks 2 and 4)
INSERT INTO project_commitments (project_id, csm_id, week_start_date, estimated_hours, commitment_type, notes)
SELECT
  p.id,
  p.csm_id,
  date_trunc('week', CURRENT_DATE)::date + (s.n * 7),
  8,
  'Travel',
  'On-site go-live preparation at ' || p.name
FROM projects p
CROSS JOIN (VALUES (14), (28)) s(n)
WHERE p.stage = 'Go-Live Prep'
  AND p.csm_id IS NOT NULL;

-- Internal planning meetings (2h, weeks 0 and 2)
INSERT INTO project_commitments (project_id, csm_id, week_start_date, estimated_hours, commitment_type, notes)
SELECT DISTINCT ON (p.csm_id, s.n)
  p.id,
  p.csm_id,
  date_trunc('week', CURRENT_DATE)::date + (s.n * 7),
  2,
  'Internal Meeting',
  'Sprint planning and capacity review'
FROM projects p
CROSS JOIN (VALUES (0), (14)) s(n)
WHERE p.csm_id IS NOT NULL
ORDER BY p.csm_id, s.n, p.id;

-- ============================================================================
-- 5. ENABLE RLS (Row Level Security) — open for service_role key
-- ============================================================================
ALTER TABLE capacity_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_commitments ENABLE ROW LEVEL SECURITY;

-- Allow full access via service_role key (used by the app)
CREATE POLICY "Allow all for service role" ON capacity_entries
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for service role" ON project_commitments
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- DONE. Verify with:
--   SELECT count(*) FROM capacity_entries;
--   SELECT count(*) FROM project_commitments;
-- ============================================================================
