-- Migration: Rename phases and add estimated_hours to tasks
-- Run this in Supabase SQL Editor

-- Rename phases on projects
UPDATE projects SET stage = 'Design' WHERE stage = 'Discovery';
UPDATE projects SET stage = 'Config' WHERE stage = 'Implementation';
UPDATE projects SET stage = 'Training' WHERE stage = 'Testing & QA';
UPDATE projects SET stage = 'Deploying to Production' WHERE stage = 'Go-Live Prep';
UPDATE projects SET stage = 'Go Live Support' WHERE stage = 'Go-Live';

-- Rename phases on tasks
UPDATE tasks SET phase = 'Design' WHERE phase = 'Discovery';
UPDATE tasks SET phase = 'Config' WHERE phase = 'Implementation';
UPDATE tasks SET phase = 'Training' WHERE phase = 'Testing & QA';
UPDATE tasks SET phase = 'Deploying to Production' WHERE phase = 'Go-Live Prep';
UPDATE tasks SET phase = 'Go Live Support' WHERE phase = 'Go-Live';

-- Add estimated_hours column to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,1);

-- Distribute phase hours evenly across tasks per project per phase
-- Totals: Kickoff=4, Design=16, Config=64, Training=6, Deploy=24, Go Live Support=10 (124h)
WITH phase_hours(phase, total) AS (VALUES
  ('Kickoff',4),('Design',16),('Config',64),
  ('Training',6),('Deploying to Production',24),('Go Live Support',10)
),
counts AS (
  SELECT project_id, phase, COUNT(*) AS n FROM tasks GROUP BY project_id, phase
)
UPDATE tasks t SET estimated_hours = ph.total::numeric / c.n
FROM counts c JOIN phase_hours ph ON ph.phase = c.phase
WHERE t.project_id = c.project_id AND t.phase = c.phase;
