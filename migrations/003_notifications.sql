-- ============================================================================
-- MONUMENT — NOTIFICATION RULES (idempotent)
-- One row per event type. Cron emailers read TO + CC from here instead of
-- ALERT_TO_EMAILS / EXEC_EMAIL env vars. Env-var values are still used as a
-- fallback if a rule has an empty recipient list.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type       TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  description      TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  to_recipients    TEXT[] NOT NULL DEFAULT '{}',
  cc_recipients    TEXT[] NOT NULL DEFAULT '{}',
  -- How much lead time for "upcoming" events, if applicable.
  lead_time_hours  INT,
  -- Status: 'wired' = cron actually fires this, 'pending' = UI row only.
  status           TEXT NOT NULL DEFAULT 'wired'
                     CHECK (status IN ('wired','pending')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_event ON notification_rules(event_type);

DROP TRIGGER IF EXISTS trg_notif_updated ON notification_rules;
CREATE TRIGGER trg_notif_updated BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_all ON notification_rules;
CREATE POLICY notif_all ON notification_rules FOR ALL USING (true) WITH CHECK (true);

-- Seed rows: one per event type Monument can emit. UI edits these; cron reads
-- them. We keep rows for events that aren't wired up yet (status='pending')
-- so ops can see what's possible and pre-configure recipients.
INSERT INTO notification_rules (event_type, label, description, status, lead_time_hours) VALUES
  ('task.late',
   'Late task escalation',
   'Morning email to each CSM listing their late tasks, plus an exec summary. Fires weekdays at 08:00 CT.',
   'wired', NULL),
  ('task.upcoming',
   'Upcoming task reminder',
   'Afternoon email to each CSM listing tasks due in the next 5 business days. Fires weekdays at 16:00 CT.',
   'wired', 120),
  ('milestone.complete',
   'Milestone completion',
   'Sent when a task marked as a milestone transitions to "complete". (Trigger not yet wired — configure here so recipients are ready.)',
   'pending', NULL),
  ('project.health_change',
   'Project health change',
   'Sent when a project transitions between On Track / At Risk / Critical. (Trigger not yet wired.)',
   'pending', NULL),
  ('integration.sync_failed',
   'Integration sync failed',
   'Sent when a Teams or Salesforce sync run ends in error. (Trigger not yet wired — will fire from the sync endpoints.)',
   'pending', NULL)
ON CONFLICT (event_type) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  status      = EXCLUDED.status;

COMMENT ON TABLE notification_rules IS
  'Configurable per-event notification recipients. Cron emailers read TO+CC from here.';
