-- Seed the Outlook / Exchange Online integration row.
-- The provider value 'outlook' is already allowed by the CHECK constraint
-- added in migration 002. Safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO integrations (provider, display_name, status)
VALUES ('outlook', 'Outlook / Exchange', 'disconnected')
ON CONFLICT (provider) DO NOTHING;
