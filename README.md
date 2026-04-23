# Monument — PS Operations Platform

React + Vite frontend, Supabase (PostgreSQL) backend, Vercel serverless
functions for integrations and cron.

## What's in here

- **Executive view** — portfolio KPIs, health pie, CSM ARR, late/upcoming tasks.
- **Consultant portal** — per-CSM task + capacity view with inline editing.
- **Configuration** — `/config` (see nav bar):
  - **Projects** — full CRUD on accounts/projects.
  - **CSMs** — full CRUD, activate/deactivate.
  - **Assignments** — CSM ↔ account with role + allocation + date range.
  - **Integrations** — configure Microsoft Teams + Salesforce, sync, test.
  - **Audit Log** — append-only event stream with before/after diffs.
  - **Security** — live SOC 2 CC6/CC7/CC8/CC9/A1/PI1 posture summary.
- **AI Analyst** — Claude-powered sidebar (reads portfolio context).
- **Cron emails** — morning late-task + afternoon upcoming reminders.

## Running locally

```bash
npm install
npm run dev
```

The dev server is at `http://localhost:5173`. The `/api/*` routes need
`vercel dev` (or deploy to Vercel) because they're serverless functions.

## Schema

All schema is now in `migrations/`:

1. `migrations/001_base_schema.sql` — `csms`, `projects`, `tasks`,
   `vw_portfolio`, `vw_csm_scorecard`, updated_at triggers, RLS.
2. `migrations/002_integrations.sql` — `csm_assignments`, `integrations`,
   `customer_interactions`, `sync_runs`, `audit_log` (append-only), seeds
   Teams + Salesforce as registered integrations.
3. `migration.sql` — capacity forecasting (`capacity_entries`,
   `project_commitments`) with seed data.
4. `migration-phases.sql` — `estimated_hours` per task phase.

Run them in order in the Supabase SQL Editor. They're idempotent.

## Environment variables (Vercel → Settings → Environment Variables)

| Name                     | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `SUPABASE_URL`           | Project URL                                       |
| `SUPABASE_SERVICE_KEY`   | Service role key (server-only — **never client**) |
| `ANTHROPIC_API_KEY`      | Claude AI panel (`/api/claude`)                   |
| `RESEND_API_KEY`         | Email cron jobs                                   |
| `CRON_SECRET`            | Bearer token Vercel sends to cron paths           |
| `EXEC_EMAIL`             | Executive summary recipient                       |
| `FROM_EMAIL`             | `Monument <alerts@yourdomain>`                    |
| `APP_URL`                | Public URL (used in email links + CORS allowlist) |
| `TEAMS_CLIENT_SECRET`    | Reference name; you pick it in the Integrations UI|
| `SALESFORCE_CLIENT_SECRET` | Reference name; you pick it in the Integrations UI |

## Integrations — how a customer connects Teams / Salesforce

1. Open the Configuration tab → **Integrations**.
2. Click **Configure** on the provider.
3. Paste tenant_id / client_id (or instance_url / client_id for Salesforce).
4. Pick an env var **name** (e.g. `TEAMS_CLIENT_SECRET`) — this is only a
   pointer. The actual secret never goes through the database.
5. Save. The server generates a new random HMAC webhook secret and returns
   it **once** in the response. Paste that secret into the external system's
   webhook configuration (Graph subscription `clientState`, or Salesforce
   Outbound Message header `X-Signature`).
6. Set the client secret on the server:
   ```bash
   vercel env add TEAMS_CLIENT_SECRET production
   ```
7. Click **Test** to verify OAuth token acquisition, then **Sync Now** to
   backfill 24 hours of history. Ongoing changes stream in via webhook.

All inbound webhooks verify an HMAC signature (`X-Signature: sha256=...`)
before writing. Replays are idempotent thanks to the
`(source_system, external_id)` uniqueness constraint on
`customer_interactions`.

## Security posture

Opinionated defaults designed to clear SOC 2 CC6/CC7/CC8/CC9/A1/PI1 controls:

- **Append-only audit log** — triggers block UPDATE/DELETE even for
  service_role. Writes happen server-side only.
- **RLS on every table.** Browser uses the anon key; integration secrets sit
  behind `vw_integrations_public`.
- **Secrets by reference.** Only env var names (e.g. `TEAMS_CLIENT_SECRET`)
  live in the DB. Actual values are set via `vercel env`.
- **HMAC-verified webhooks** with timing-safe compare (`api/_lib/security.js`).
- **Per-IP token-bucket rate limiting** on every `/api/*` route.
- **Hardened responses** — HSTS, nosniff, DENY framing, Referrer-Policy,
  Permissions-Policy, strict CSP (see `vercel.json`).
- **Optimistic UI with rollback** so failed writes can't desync.
- **Request-ID tracing** ties audit events back to individual HTTP calls.

## Follow-ups

- Replace demo credentials with Supabase Auth + SSO (role: admin/exec/csm).
- Add a Vercel KV or Upstash Redis rate-limit store (current in-memory one
  is region-scoped).
- Add an activity feed surfacing `customer_interactions` per account on the
  portfolio table.
