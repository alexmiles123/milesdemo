-- Migration: Add estimated_hours to tasks and distribute phase hours
-- Run this in Supabase SQL Editor

-- Add estimated_hours column to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,1);

-- Distribute phase hours evenly across tasks per project per phase
-- Totals: Kickoff=4, Discovery=16, Implementation=64, Testing & QA=6, Go-Live Prep=24, Go-Live=10 (124h)
WITH phase_hours(phase, total) AS (VALUES
  ('Kickoff',4),('Discovery',16),('Implementation',64),
  ('Testing & QA',6),('Go-Live Prep',24),('Go-Live',10)
),
counts AS (
  SELECT project_id, phase, COUNT(*) AS n FROM tasks GROUP BY project_id, phase
)
UPDATE tasks t SET estimated_hours = ph.total::numeric / c.n
FROM counts c JOIN phase_hours ph ON ph.phase = c.phase
WHERE t.project_id = c.project_id AND t.phase = c.phase;
