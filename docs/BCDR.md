# Business Continuity & Disaster Recovery (BC/DR)

**Application:** Monument — Professional Services Portfolio Intelligence  
**Last Updated:** 2026-04-29  
**Owner:** Alex Miles (alexmiles123@gmail.com)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack & Hosting](#2-tech-stack--hosting)
3. [Environment Variables](#3-environment-variables)
4. [Database Schema & Migrations](#4-database-schema--migrations)
5. [API Routes](#5-api-routes)
6. [Cron Jobs & Webhooks](#6-cron-jobs--webhooks)
7. [External Service Dependencies](#7-external-service-dependencies)
8. [Security Architecture](#8-security-architecture)
9. [Deployment Runbook](#9-deployment-runbook)
10. [Backup & Recovery](#10-backup--recovery)
11. [Failure Scenarios & Remediation](#11-failure-scenarios--remediation)
12. [RTO / RPO Targets](#12-rto--rpo-targets)
13. [Seed & Reset Scripts](#13-seed--reset-scripts)
14. [Key Contacts & Access Checklist](#14-key-contacts--access-checklist)

---

## 1. System Overview

Monument is a PSA (Professional Services Automation) intelligence dashboard for Customer Success Managers and executives. It tracks project health, capacity, customer interactions, and AI-generated executive briefs.

**Core capabilities:**
- CSM portfolio view (project health, ARR, task tracking)
- Executive capacity dashboard with 12-week forecasting
- Account detail with timeline, AI brief, file attachments
- Salesforce + Microsoft Teams integration (sync + inbound webhooks)
- Automated email alerts (morning + afternoon cron)
- AI Analyst sidebar (Claude API, spend-capped)

---

## 2. Tech Stack & Hosting

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + Vite | React 19.2.5 / Vite 8.0.9 |
| Charts | Recharts | 3.8.1 |
| Spreadsheet import/export | XLSX | 0.18.5 |
| Backend | Vercel Serverless Functions (Node.js) | — |
| Database | PostgreSQL via Supabase | — |
| File storage | Supabase Storage (S3-compatible) | Bucket: `project-files` |
| Auth | Custom JWT (bcrypt + jose) + HttpOnly cookies | — |
| Email | Resend API | — |
| AI | Anthropic Claude API | claude-sonnet-4-6 (default) |
| Analytics | Vercel Analytics | — |
| Rate limiting | In-memory per region (optional Upstash Redis) | — |
| CI/CD | GitHub → Vercel auto-deploy on push to `main` | — |

**Repository:** GitHub (private)  
**Production URL:** Set as `APP_URL` in Vercel env vars  
**Deploy trigger:** Any push to `main` branch

---

## 3. Environment Variables

All of these must be set in the **Vercel project settings → Environment Variables** before the app functions. Never commit real values to Git.

### Required

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project endpoint (`https://<project>.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Service-role key — bypasses RLS; used server-side only |
| `SUPABASE_ANON_KEY` | Public anon key (embedded in Vite build for client-side reads) |
| `APP_JWT_SECRET` | Secret for signing session JWTs — min 32 chars, random |
| `APP_URL` | Canonical origin (e.g. `https://monument.vercel.app`) — used in CORS, email links, webhook callbacks |
| `ANTHROPIC_API_KEY` | Claude API key for `/api/claude` proxy |
| `RESEND_API_KEY` | Resend API key for cron alert emails |
| `CRON_SECRET` | Bearer token Vercel sends on cron requests — validates inbound cron calls |
| `FROM_EMAIL` | Sender address for alerts (e.g. `Monument <alerts@yourdomain.com>`) |
| `PII_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypting audit log PII — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

### Bootstrap (fallback login when `app_users` table is empty)

| Variable | Purpose |
|----------|---------|
| `APP_USER` | Bootstrap admin username |
| `APP_PASS_HASH` | bcrypt hash of bootstrap password |

### Optional

| Variable | Purpose |
|----------|---------|
| `ALERT_FROM_EMAIL` | Fallback sender if not set in `notification_rules` table |
| `ALERT_TO_EMAILS` | Fallback recipients (comma-separated) if no `notification_rules` rows |
| `EXEC_EMAIL` | Executive summary recipient (legacy fallback) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint for global rate limiting (otherwise per-region in-memory) |
| `UPSTASH_REDIS_REST_TOKEN` | Auth token for Upstash Redis |

### Integration Secrets (set via `vercel env add`)

These are stored as **reference names** in the DB (never the actual values). The integration handler looks up the real secret from `process.env` using the name stored in `integrations.secret_env_var`.

| Variable | Purpose |
|----------|---------|
| `TEAMS_CLIENT_SECRET` | Microsoft Entra app secret for Teams OAuth |
| `SALESFORCE_CLIENT_SECRET` | Salesforce Connected App secret |

---

## 4. Database Schema & Migrations

All migrations live in `/migrations/` and are designed to be **idempotent** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Run them in order or apply `/migrations/_all.sql` for a fresh install.

### Applying migrations

```bash
# Option A — apply-migrations.sh (requires psql + SUPABASE_DB_URL)
bash scripts/apply-migrations.sh

# Option B — Supabase SQL Editor
# Paste and run migrations/_all.sql
```

### Migration history

| File | What it does |
|------|-------------|
| `001_base_schema.sql` | Core tables: `csms`, `projects`, `tasks`, `vw_portfolio`, `vw_csm_scorecard`, `updated_at` triggers, initial RLS |
| `002_integrations.sql` | `csm_assignments`, `integrations`, `customer_interactions`, `sync_runs`, `audit_log` (append-only, SOC2-style) |
| `003_notifications.sql` | `notification_rules` — per-event-type email routing |
| `004_csm_roles.sql` | `csm_roles` lookup table (CSM, PM, Solutions Architect, etc.) |
| `005_lockdown_rls.sql` | Replaces permissive `USING(true)` RLS with strict per-row policies |
| `006_customers.sql` | `customers` table + FK backfill from `projects.customer` free-text |
| `007_app_users.sql` | `app_users` — multi-user login table (bcrypt, failed attempts, last login) |
| `008_task_templates.sql` | `task_templates`, `task_template_items` — reusable task bundles |
| `009_password_policy.sql` | `password_policy` single-row config (complexity, expiry, history) |
| `010_app_roles.sql` | `app_roles` — database-driven role definitions replacing hardcoded roles |
| `011_customer_project_fk.sql` | FK: `projects.customer_id → customers.id` with cascade delete |
| `012_claude_spend.sql` | `claude_usage`, `claude_budget` — spend-cap tracking for Anthropic API |
| `013_pii_and_gdpr.sql` | PII encryption on audit_log + `gdpr_requests` tracking table |
| `014_app_user_csm_link.sql` | `app_users.csm_id` FK → links login to CSM record for row-level authz |
| `015_refresh_jti.sql` | `consumed_jtis` — prevents refresh token replay attacks |
| `016_project_notes_and_attachments.sql` | `project_notes`, `project_attachments` + Supabase Storage bucket setup |
| `017_rls_sweep.sql` | Defensive: enables RLS on every table; revokes anon/authenticated grants |
| `018_rename_phases.sql` | Renames 6 phases → 5: Kickoff→Analysis, Discovery→Design, Implementation→Develop, Testing & QA→Evaluate, Go-Live Prep+Go-Live→Deploy |
| `019_customer_renewal_and_files.sql` | Adds `renewal_date` to `customers`; adds `customer_id` to `project_attachments` for account-level files |

### Tables (current schema)

| Table | Key columns | Notes |
|-------|-------------|-------|
| `csms` | id, name, email, is_active | PS consultants |
| `csm_roles` | name | Lookup: CSM, PM, etc. |
| `csm_assignments` | csm_id, project_id | Many-to-many project ownership |
| `projects` | id, name, customer_id, csm_id, stage, health, arr, target_date, completion_pct | Core entity |
| `tasks` | id, project_id, phase, name, status, priority, proj_date, estimated_hours | Stage: Analysis/Design/Develop/Evaluate/Deploy |
| `customers` | id, name, contact_name, contact_email, renewal_date, is_active | Account records |
| `customer_interactions` | id, customer_id, interaction_type, source_system, external_id, occurred_at | Teams/Salesforce events + manual notes |
| `integrations` | id, type, tenant_id, client_id, secret_env_var, webhook_secret | One row per connected system |
| `sync_runs` | id, integration_id, status, started_at, completed_at | Sync audit log |
| `audit_log` | id, actor, action, target_table, target_id, before_state, after_state | Append-only; immutable |
| `app_users` | id, username, password_hash, role, csm_id, failed_attempts | Login accounts |
| `app_roles` | name, label, can_view_exec, can_view_config | Role permissions |
| `task_templates` | id, name | Template sets |
| `task_template_items` | id, template_id, phase, name, priority | Template tasks |
| `password_policy` | min_length, require_uppercase, require_number, require_special, expiry_days | Single row |
| `capacity_entries` | csm_id, week_start_date, estimated_hours | Weekly availability |
| `project_commitments` | csm_id, project_id, week_start_date, estimated_hours, commitment_type | Weekly project hours |
| `project_notes` | id, project_id, author, body | Rich text notes |
| `project_attachments` | id, project_id (nullable), customer_id (nullable), csm_id, file_name, storage_path, size_bytes | File metadata; at least one of project_id/customer_id required |
| `notification_rules` | event_type, recipient_emails | Alert routing |
| `claude_usage` | actor, model, input_tokens, output_tokens, cost_usd_cents | Anthropic spend log |
| `claude_budget` | monthly_cap_cents, per_user_cap_cents, enabled | Single row; spend gate |
| `consumed_jtis` | jti, consumed_at | Refresh token replay prevention |
| `gdpr_requests` | user_id, type (export/delete), requested_at, completed_at | GDPR compliance tracking |

### Views

| View | Purpose |
|------|---------|
| `vw_portfolio` | Projects joined with CSM name — main data source for consultant portal |
| `vw_csm_scorecard` | Aggregated metrics per CSM (ARR, health counts, late tasks) |
| `vw_integrations_public` | Integrations without secret fields — safe for frontend |

---

## 5. API Routes

All routes are Vercel serverless functions under `/api/`. Every route validates a session JWT before executing.

### Authentication (`/api/auth/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Username/password → session + refresh JWT cookies |
| POST | `/api/auth/refresh` | Rotate session using refresh token; records JTI |
| POST | `/api/auth/logout` | Blacklist refresh token JTI |
| POST | `/api/auth/forgot` | Send password reset email (Resend) with signed link |
| GET  | `/api/auth/me` | Return current session user, role, csm_id |

### Admin (`/api/admin/`) — requires `role = admin`

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH | `/api/admin/users` | List/create/update/delete app_users |
| GET/POST/PATCH | `/api/admin/roles` | Manage app_roles |
| GET/POST/PATCH | `/api/admin/templates` | Manage task templates |
| POST | `/api/admin/apply-template` | Stamp template tasks onto a project |
| POST | `/api/admin/gdpr/export` | Export all PII for a user |
| POST | `/api/admin/gdpr/delete` | GDPR right-to-erasure (anonymize + delete) |

### Database Proxy (`/api/db/`)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH/DELETE | `/api/db/<table>?<filters>` | Authenticated proxy to Supabase REST API using service key. Validates JWT, enforces per-table allowlist, writes audit log for mutations. |

Allowed tables: `csms`, `csm_roles`, `csm_assignments`, `projects`, `tasks`, `capacity_entries`, `project_commitments`, `customers`, `customer_interactions`, `integrations`, `sync_runs`, `notification_rules`, `project_notes`, `project_attachments`, `audit_log`, `vw_portfolio`, `vw_csm_scorecard`, `vw_integrations_public`

### Integrations (`/api/integrations/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/integrations/connect` | Store integration config; generate webhook secret |
| POST | `/api/integrations/teams/test` | Test Teams OAuth token acquisition |
| POST | `/api/integrations/teams/sync` | Backfill last-24h Teams events |
| POST | `/api/integrations/teams/webhook` | Inbound Teams Graph notifications (HMAC-verified) |
| POST | `/api/integrations/salesforce/test` | Test Salesforce OAuth token |
| POST | `/api/integrations/salesforce/sync` | Backfill last-24h Salesforce records |
| POST | `/api/integrations/salesforce/webhook` | Inbound Salesforce Outbound Messages (HMAC-verified) |

### Files (`/api/files`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/files` | Upload file (base64 JSON) to Supabase Storage; record metadata in `project_attachments`. Accepts `project_id` or `customer_id`. Max 5 MB. |
| GET | `/api/files?id=<uuid>` | Return 60-second signed download URL |
| DELETE | `/api/files?id=<uuid>` | Delete storage object + metadata row |

### Other

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/claude` | Authenticated proxy to Anthropic API; enforces spend cap |
| POST | `/api/audit` | Write audit_log entries (service-role) |
| POST | `/api/log-error` | Client-side error logging |
| GET/PATCH | `/api/password-policy` | Read/update password policy |

---

## 6. Cron Jobs & Webhooks

### Cron Jobs (Vercel-managed)

Defined in `vercel.json`. Vercel sends a `POST` with `Authorization: Bearer <CRON_SECRET>`.

| Route | Schedule (UTC) | Local (EST) | Action |
|-------|---------------|-------------|--------|
| `/api/cron/morning-alerts` | `0 13 * * 1-5` | Mon–Fri 8:00 AM | Email: late tasks + upcoming deadlines for each CSM |
| `/api/cron/afternoon-reminders` | `0 21 * * 1-5` | Mon–Fri 4:00 PM | Email: reminder to update projected dates |

**To disable:** Set `enabled: false` on the matching `notification_rules` row, or remove the route from `vercel.json` and redeploy.

**To test manually:** `POST /api/cron/morning-alerts` with `Authorization: Bearer <CRON_SECRET>` header.

### Inbound Webhooks

| System | Path | Verification |
|--------|------|-------------|
| Microsoft Teams (Graph) | `/api/integrations/teams/webhook` | `clientState` field matches `integrations.webhook_secret`; HMAC-SHA256 over raw body |
| Salesforce | `/api/integrations/salesforce/webhook` | `X-Signature: sha256=<hex>` header; timing-safe HMAC-SHA256 compare |

Both are idempotent via `(source_system, external_id)` unique constraint on `customer_interactions`.

**To re-register a webhook after secret rotation:**  
1. Regenerate webhook secret via Monument → Configuration → Integrations → Edit  
2. Update the webhook subscription on the external system (Teams Graph portal / Salesforce Setup) with the new endpoint + new secret

---

## 7. External Service Dependencies

| Service | Purpose | Outage Impact | Recovery |
|---------|---------|--------------|----------|
| **Supabase** | Database + file storage | Total app failure — all API calls return 5xx | Wait for Supabase SLA (99.9%). Manual: use Supabase backup + restore. |
| **Vercel** | Frontend hosting + serverless compute | App unreachable | Vercel SLA (99.99%). Failover: export static build from `dist/` to any CDN. |
| **Anthropic (Claude)** | AI Analyst sidebar | AI features fail; rest of app unaffected | Graceful: frontend shows error message. Rotate API key if compromised. |
| **Resend** | Cron alert emails | Morning/afternoon emails fail silently | Check Resend dashboard. Rotate `RESEND_API_KEY` if compromised. |
| **Microsoft Graph** | Teams integration | Teams sync + webhooks stop; historical data retained | Re-test OAuth token via Integrations tab. Re-register Graph subscription if expired (max 3 days). |
| **Salesforce REST** | Salesforce integration | Salesforce sync + webhooks stop; historical data retained | Re-test OAuth token. Refresh credentials if client secret rotated. |
| **Upstash Redis** | Global rate limiting (optional) | Falls back to per-region in-memory rate limiting — not a hard failure | Check Upstash dashboard. `UPSTASH_REDIS_REST_URL` env var can be removed to disable. |

---

## 8. Security Architecture

| Control | Implementation |
|---------|---------------|
| Authentication | JWT session + refresh pair; signed with `APP_JWT_SECRET`; set as HttpOnly cookies (XSS-resistant) |
| Authorization | Vercel functions validate JWT on every request; RLS enabled on every Postgres table; DB proxy enforces table allowlist |
| Password hashing | bcryptjs (work factor 12); configurable complexity in `password_policy` |
| Token replay prevention | Refresh token JTI written to `consumed_jtis` on use; unique constraint blocks reuse |
| Integration secrets | Stored as env var reference names in DB — actual secrets never written to database or logs |
| Webhook verification | HMAC-SHA256 timing-safe compare on every inbound webhook |
| File access | No public URLs — all downloads go through signed URL endpoint (`/api/files?id=`) with 60s TTL |
| Audit trail | Append-only `audit_log` with before/after diffs; RLS trigger prevents DELETE/UPDATE even with service key |
| PII encryption | Sensitive fields in `audit_log` encrypted using `PII_ENCRYPTION_KEY` |
| Rate limiting | Per-IP token bucket on every `/api/*` endpoint |
| Security headers | HSTS (2yr), X-Frame-Options: DENY, X-Content-Type-Options, CSP (`default-src 'self'`), Referrer-Policy — set in `vercel.json` |
| CORS | Locked to `APP_URL` origin |

---

## 9. Deployment Runbook

### Fresh install (new environment)

```
1. Create Supabase project
   → Note: project URL, service key, anon key

2. Apply schema
   → Supabase SQL Editor → paste migrations/_all.sql → Run

3. Create login
   → Supabase SQL Editor → paste migrations/seed_alex_login.sql → Run
   (or create app_user via Configuration → Users tab after step 6)

4. Set Vercel environment variables (all listed in §3)
   vercel env add SUPABASE_URL production
   vercel env add SUPABASE_SERVICE_KEY production
   ... (repeat for all required vars)

5. Connect GitHub repo → Vercel
   → Vercel dashboard → Import project → select repo
   → Framework: Vite → Root: / → Build: npm run build

6. Deploy
   git push origin main
   → Vercel auto-deploys

7. Verify
   → Open APP_URL → login with seeded credentials
   → Check Exec Dashboard loads data
```

### Applying a new migration

```bash
# In Supabase SQL Editor:
# Paste the migration file contents → Run

# Or via CLI (requires psql + SUPABASE_DB_URL env var):
bash scripts/apply-migrations.sh
```

### Rolling back a bad deploy

```bash
# Vercel: redeploy previous build from dashboard
# Vercel UI: Deployments → previous deploy → "Redeploy"

# Or Git revert:
git revert HEAD
git push origin main
```

Migrations are **not** automatically rolled back. If a migration caused data issues, write a corrective SQL and apply it manually.

### Rotating secrets

| Secret | Steps |
|--------|-------|
| `APP_JWT_SECRET` | Set new value in Vercel env → redeploy → all existing sessions will be invalidated (users must re-login) |
| `SUPABASE_SERVICE_KEY` | Rotate in Supabase dashboard → update `SUPABASE_SERVICE_KEY` in Vercel → redeploy |
| `ANTHROPIC_API_KEY` | Rotate in Anthropic console → update `ANTHROPIC_API_KEY` in Vercel → redeploy |
| `RESEND_API_KEY` | Rotate in Resend dashboard → update `RESEND_API_KEY` in Vercel → redeploy |
| Integration webhook secret | Monument UI → Integrations → Edit → Regenerate Secret → update webhook subscription on external system |

---

## 10. Backup & Recovery

### Database

- **Supabase auto-backups:** Enabled by default on paid plans (daily backups, 7-day retention on Pro; check your plan)
- **Manual export:** Supabase dashboard → Settings → Database → Download backup, or use `pg_dump` with `SUPABASE_DB_URL`
- **Recovery:** Supabase dashboard → Restore from backup (point-in-time on Pro tier)
- **Validation after restore:** Run `SELECT COUNT(*) FROM projects; SELECT COUNT(*) FROM customers;` to confirm data presence

### File storage

- **Supabase Storage** stores all uploaded files in the `project-files` bucket
- Bucket contents are backed up alongside the database on Supabase Pro
- After a database restore, verify storage objects match `project_attachments.storage_path` values

### Code / config

- Source of truth is the **GitHub repository**
- No local state needs to be backed up — all state is in Supabase
- Environment variables: export from Vercel dashboard and store securely (1Password, etc.)

### Audit log

- `audit_log` is append-only with a trigger preventing DELETE/UPDATE (immutable even with service key)
- Included in any Supabase database backup
- Can be exported to CSV: `SELECT * FROM audit_log ORDER BY created_at DESC` in SQL Editor

---

## 11. Failure Scenarios & Remediation

### Scenario 1 — Supabase outage

**Symptom:** All pages show errors; `/api/db/*` returns 502  
**Impact:** Total app failure  
**Remediation:**
1. Check [status.supabase.com](https://status.supabase.com)
2. Wait for resolution (SLA 99.9% = max ~8.7h/year downtime)
3. If persistent: restore from latest backup to a new Supabase project; update `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in Vercel → redeploy

### Scenario 2 — Bad code deploy

**Symptom:** App crashes after a push to `main`  
**Remediation:**
1. Vercel dashboard → Deployments → click previous successful deploy → "Redeploy"
2. Or: `git revert HEAD && git push origin main`

### Scenario 3 — Compromised `APP_JWT_SECRET`

**Symptom:** Unauthorized sessions; suspicious `audit_log` entries  
**Remediation:**
1. Immediately rotate `APP_JWT_SECRET` in Vercel → redeploy (all existing sessions invalidated)
2. Review `audit_log` for unauthorized actions
3. Force-reset all user passwords via admin panel

### Scenario 4 — Compromised integration secret (Teams / Salesforce)

**Symptom:** Unauthorized API calls; unexpected sync entries  
**Remediation:**
1. Revoke client secret in Microsoft Entra / Salesforce Setup
2. Monument UI → Integrations → Edit → Regenerate Webhook Secret
3. Add new secret to Vercel env → redeploy
4. Re-register Graph subscription (Teams) or Outbound Message endpoint (Salesforce) with new secret

### Scenario 5 — Claude spend cap hit

**Symptom:** AI Analyst shows "Your monthly Claude API quota is exhausted."  
**Remediation:**
1. Supabase SQL Editor: `UPDATE claude_budget SET per_user_cap_cents = <new_value> WHERE id = 1;`  
   (100 = $1.00, 1000 = $10.00, 10 = $0.10)
2. Or wait until next calendar month (cap resets on 1st of month UTC)

### Scenario 6 — File storage object orphaned

**Symptom:** Download fails with 404 from signed URL; row exists in `project_attachments`  
**Remediation:**
1. Supabase Storage console → `project-files` bucket → verify object exists at `storage_path`
2. If missing: delete the orphaned `project_attachments` row: `DELETE FROM project_attachments WHERE id = '<uuid>';`

### Scenario 7 — Cron emails not sending

**Symptom:** No morning/afternoon emails; no error visible  
**Remediation:**
1. Vercel dashboard → Functions → `/api/cron/morning-alerts` → view logs
2. Check `RESEND_API_KEY` is set and valid
3. Check `notification_rules` table has rows with correct `recipient_emails`
4. Manually trigger: `curl -X POST https://<APP_URL>/api/cron/morning-alerts -H "Authorization: Bearer <CRON_SECRET>"`

### Scenario 8 — Refresh token table bloat (`consumed_jtis`)

**Symptom:** Slow auth refreshes over time  
**Remediation:**
```sql
DELETE FROM consumed_jtis WHERE consumed_at < NOW() - INTERVAL '90 days';
```
Recommend adding this as a monthly cron job.

### Scenario 9 — Microsoft Graph subscription expired

**Symptom:** Teams webhooks stop arriving (subscriptions expire after max 3 days)  
**Remediation:**
1. Monument UI → Integrations → Teams → Test (to verify OAuth still works)
2. If OAuth OK: re-register the subscription via the Microsoft Graph Explorer or the Teams sync endpoint
3. If OAuth fails: rotate `TEAMS_CLIENT_SECRET` in Azure AD → update Vercel env → redeploy

---

## 12. RTO / RPO Targets

| Scenario | RPO (data loss) | RTO (downtime) |
|----------|----------------|----------------|
| Vercel function regression | 0 (no data at risk) | < 5 min (redeploy previous build) |
| Supabase outage (short) | 0 | Supabase SLA (typically minutes) |
| Supabase data corruption | Last backup (up to 24h on free tier) | 30–60 min (restore + verify) |
| Secret compromise | 0 | < 15 min (rotate + redeploy) |
| Integration webhook failure | Events missed during outage | < 30 min (re-register subscription + manual sync) |
| Total loss (new environment) | Last backup | 2–4 hours (fresh Supabase + Vercel setup) |

---

## 13. Seed & Reset Scripts

> **Warning:** These scripts modify or delete data. Run only in the Supabase SQL Editor on the intended environment.

| Script | Location | What it does | Destructive? |
|--------|----------|-------------|--------------|
| `_all.sql` | `migrations/` | Applies all 19 migrations in order (idempotent) | No |
| `seed_alex_csm.sql` | `migrations/` | Creates CSM record for Alex Miles | No |
| `seed_alex_login.sql` | `migrations/` | Creates admin `app_user` linked to Alex's CSM | No |
| `reset_data.sql` | `migrations/` | Wipes all projects, customers, tasks, interactions, notes, attachments — keeps schema, users, templates, integrations | **Yes (data)** |
| `wipe_projects_and_customers.sql` | `migrations/` | `TRUNCATE` with CASCADE on projects/customers/tasks/notes/attachments | **Yes (data)** |

### Full environment reset (dev/staging only)

```sql
-- 1. Wipe all data
\i migrations/wipe_projects_and_customers.sql

-- 2. Re-seed CSM + login
\i migrations/seed_alex_csm.sql
\i migrations/seed_alex_login.sql
```

---

## 14. Key Contacts & Access Checklist

### Access required to operate/recover

| System | URL | Who has access |
|--------|-----|---------------|
| GitHub repository | github.com | Alex Miles |
| Vercel project | vercel.com | Alex Miles |
| Supabase project | supabase.com | Alex Miles |
| Anthropic console | console.anthropic.com | Alex Miles |
| Resend dashboard | resend.com | Alex Miles |
| Microsoft Azure / Entra (Teams app) | portal.azure.com | Alex Miles |
| Salesforce Setup (Connected App) | — | Alex Miles |

### Pre-incident checklist

Before any deployment or secret rotation, verify access to all systems above. In a disaster recovery scenario, the minimum access required is:

- [ ] Supabase dashboard (database access)
- [ ] Vercel dashboard (env vars + redeploy)
- [ ] GitHub repository (code rollback)

### Useful SQL queries

```sql
-- Check current spend cap
SELECT * FROM claude_budget;

-- Review recent audit log
SELECT created_at, actor, action, target_table FROM audit_log ORDER BY created_at DESC LIMIT 50;

-- Count active projects / customers
SELECT COUNT(*) FROM projects WHERE stage != 'Deploy';
SELECT COUNT(*) FROM customers WHERE is_active = true;

-- Check consumed JTIs table size
SELECT COUNT(*), MIN(consumed_at), MAX(consumed_at) FROM consumed_jtis;

-- Verify all migrations applied (check latest table exists)
SELECT to_regclass('public.consumed_jtis');  -- migration 015
SELECT to_regclass('public.project_attachments');  -- migration 016
SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='renewal_date';  -- migration 019
```
