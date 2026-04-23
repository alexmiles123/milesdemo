# Monument — Deployment Guide

Five steps. Expect 15–30 minutes total if this is your first deploy.

---

## 1 · Apply database migrations to Supabase

You have two options. Both are idempotent (safe to re-run).

### Option A · Supabase SQL Editor (no CLI needed, fastest)

1. Open **Supabase dashboard → SQL Editor → New query**.
2. Copy the entire contents of `migrations/_all.sql` into the editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Verify: in the **Table Editor** you should now see `csms`, `projects`, `tasks`, `csm_assignments`, `integrations`, `customer_interactions`, `sync_runs`, `audit_log`.

### Option B · psql + the migration script

```bash
# From Supabase: Project Settings → Database → Connection string → URI (direct, not pooler)
export SUPABASE_DB_URL="postgres://postgres:<password>@db.<project>.supabase.co:5432/postgres"
./scripts/apply-migrations.sh
```

---

## 2 · Set Vercel environment variables

Set these in **Vercel dashboard → Project → Settings → Environment Variables** (or via `vercel env add`). All three environments (Production, Preview, Development) unless noted.

| Name | Value | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<project>.supabase.co` | Public — also used client-side. |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` | Public — client-side reads. |
| `SUPABASE_SERVICE_KEY` | `eyJhbGc...` | **Server-only.** Never prefix with `VITE_`. |
| `APP_URL` | `https://monument.example.com` | Your canonical origin. Used for CORS. |
| `TEAMS_CLIENT_SECRET` | (from Azure AD app registration) | Only after you configure Teams in the UI. |
| `SALESFORCE_CLIENT_SECRET` | (from Salesforce Connected App) | Only after you configure Salesforce in the UI. |
| `ALERT_FROM_EMAIL` | `monument-alerts@yourdomain.com` | Used by cron emailer. |
| `ALERT_TO_EMAILS` | `csm-ops@yourdomain.com` | Comma-separated for multiple recipients. |
| `RESEND_API_KEY` | `re_...` | If you use Resend for alert emails. |

**Naming rule.** The integration config UI asks for an env var *name*. Whatever you type there must match a name you set in Vercel. Convention: `TEAMS_CLIENT_SECRET`, `SALESFORCE_CLIENT_SECRET`.

---

## 3 · Push to GitHub → auto-deploy to Vercel

If your Vercel project is already wired to `alexmiles123/milesdemo` (it is, based on the origin), pushing to `main` triggers a deploy automatically.

This branch (`claude/determined-napier-acf9a1`) is already pushed. Merge it:

```bash
# From your local checkout
git checkout main
git pull
git merge claude/determined-napier-acf9a1
git push origin main
```

Or open a PR from the branch and merge in the GitHub UI.

---

## 4 · Connect integrations through the UI

1. Open the deployed app → sign in (demo creds) → **Configuration → Integrations**.
2. Click **Configure** on Microsoft Teams:
   - **Tenant ID** — from Azure Portal → Azure AD → Overview → Tenant ID.
   - **Client ID** — from your Azure App Registration → Application (client) ID.
   - **Client secret env var name** — type `TEAMS_CLIENT_SECRET` (matching what you set in Vercel).
   - Click **Save & Connect**. The modal shows a **webhook secret** — copy it.
3. In Azure, create a Graph subscription (or configure the webhook) pointing to `https://<app>/api/integrations/teams/webhook` and use the webhook secret as `clientState`.
4. Repeat for Salesforce:
   - **Instance URL** — e.g. `https://yourcompany.my.salesforce.com`.
   - **Client ID** — Consumer Key from your Salesforce Connected App.
   - **Client secret env var name** — `SALESFORCE_CLIENT_SECRET`.
   - Wire the returned webhook secret into your Salesforce Outbound Message / Platform Event config.

---

## 5 · Smoke test

In the Configuration UI:

- **Integrations tab** — Click **Test** on each card. Expect a green toast.
- **Integrations tab** — Click **Sync Now**. Watch **Recent Sync Activity** for a `SUCCEEDED` row.
- **Audit tab** — You should see `integration.test`, `integration.sync` events with non-empty metadata.
- **Security tab** — all six control families should show mostly ✓ green.

If **Test** fails with `401` or `invalid_client`, the env var name in the config doesn't match what's in Vercel, or the secret value itself is wrong.

If **Sync** succeeds but `records_upserted = 0`, the external system has no events in the last 24 hours, or the project `external_ids` mapping isn't set up yet — edit a project in the Projects tab and add its Salesforce account ID / Teams group ID to the `external_ids` JSONB column via Supabase Table Editor.

---

## Rolling back

Every migration is idempotent but none drop tables. To wipe and start over:

```sql
-- Supabase SQL Editor, in this order:
DROP TABLE IF EXISTS audit_log, sync_runs, customer_interactions, integrations,
  csm_assignments, tasks, projects, csms CASCADE;
DROP VIEW IF EXISTS vw_integrations_public, vw_portfolio, vw_csm_scorecard CASCADE;
```

Then re-run `migrations/_all.sql`.

---

## Known follow-ups (not blockers)

- Demo auth is still in place. Swap to **Supabase Auth + SSO** before any real customer data lands.
- Rate-limit state is in-memory (per serverless region). Migrate to **Upstash Redis** or **Vercel KV** for a single global bucket.
- Bundle size is 724 KB. Route-level code-splitting would halve this.
