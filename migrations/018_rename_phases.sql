-- Rename 6 phases → 5 phases:
--   Kickoff       → Analysis
--   Discovery     → Design
--   Implementation→ Develop
--   Testing & QA  → Evaluate
--   Go-Live Prep  → Deploy
--   Go-Live       → Deploy
--
-- Fix: tasks.phase and task_template_items.phase have FKs referencing phases(name).
-- We must drop those FKs, do all renames, then re-add them.

BEGIN;

-- 1. Drop FK constraints that would block the rename
ALTER TABLE tasks               DROP CONSTRAINT IF EXISTS tasks_phase_fkey;
ALTER TABLE task_template_items DROP CONSTRAINT IF EXISTS task_template_items_phase_fkey;

-- 2. Rename rows in the phases lookup table
UPDATE phases SET name = 'Analysis'  WHERE name = 'Kickoff';
UPDATE phases SET name = 'Design'    WHERE name = 'Discovery';
UPDATE phases SET name = 'Develop'   WHERE name = 'Implementation';
UPDATE phases SET name = 'Evaluate'  WHERE name = 'Testing & QA';
UPDATE phases SET name = 'Deploy'    WHERE name = 'Go-Live Prep';
DELETE FROM phases               WHERE name = 'Go-Live';

-- 3. projects.stage
UPDATE projects SET stage = 'Analysis'  WHERE stage = 'Kickoff';
UPDATE projects SET stage = 'Design'    WHERE stage = 'Discovery';
UPDATE projects SET stage = 'Develop'   WHERE stage = 'Implementation';
UPDATE projects SET stage = 'Evaluate'  WHERE stage = 'Testing & QA';
UPDATE projects SET stage = 'Deploy'    WHERE stage IN ('Go-Live Prep', 'Go-Live');

-- 4. tasks.phase
UPDATE tasks SET phase = 'Analysis'  WHERE phase = 'Kickoff';
UPDATE tasks SET phase = 'Design'    WHERE phase = 'Discovery';
UPDATE tasks SET phase = 'Develop'   WHERE phase = 'Implementation';
UPDATE tasks SET phase = 'Evaluate'  WHERE phase = 'Testing & QA';
UPDATE tasks SET phase = 'Deploy'    WHERE phase IN ('Go-Live Prep', 'Go-Live');

-- 5. task_template_items.phase
UPDATE task_template_items SET phase = 'Analysis'  WHERE phase = 'Kickoff';
UPDATE task_template_items SET phase = 'Design'    WHERE phase = 'Discovery';
UPDATE task_template_items SET phase = 'Develop'   WHERE phase = 'Implementation';
UPDATE task_template_items SET phase = 'Evaluate'  WHERE phase = 'Testing & QA';
UPDATE task_template_items SET phase = 'Deploy'    WHERE phase IN ('Go-Live Prep', 'Go-Live');

-- 6. Drop old CHECK constraints and add new ones
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_stage_check,
  ADD CONSTRAINT projects_stage_check
    CHECK (stage IN ('Analysis','Design','Develop','Evaluate','Deploy'));

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_phase_check,
  ADD CONSTRAINT tasks_phase_check
    CHECK (phase IN ('Analysis','Design','Develop','Evaluate','Deploy'));

ALTER TABLE task_template_items
  DROP CONSTRAINT IF EXISTS task_template_items_phase_check,
  ADD CONSTRAINT task_template_items_phase_check
    CHECK (phase IN ('Analysis','Design','Develop','Evaluate','Deploy'));

-- 7. Re-add FK constraints
ALTER TABLE tasks
  ADD CONSTRAINT tasks_phase_fkey
    FOREIGN KEY (phase) REFERENCES phases(name);

ALTER TABLE task_template_items
  ADD CONSTRAINT task_template_items_phase_fkey
    FOREIGN KEY (phase) REFERENCES phases(name);

COMMIT;
