# Security operations

This document is the runbook for the secrets, keys, and rotation procedures
that the Monument platform depends on. Anyone with admin access to Vercel
and Supabase should be able to follow it cold.

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `APP_JWT_SECRET` | every API route via `requireAuth` | ≥32 bytes. Signs both access and refresh JWTs. |
| `APP_USER` / `APP_PASS_HASH` | `/api/auth/login` fallback path | bcrypt hash. Bootstrap-only; remove once an admin row exists in `app_users`. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | every API route | service-role key. Never ship to the browser. |
| `ANTHROPIC_API_KEY` | `/api/claude` | Anthropic workspace key. Spend cap lives in `claude_budget` (migration 012). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiter | optional; falls back to in-memory bucket when missing. |
| `PII_ENCRYPTION_KEY` | `api/_lib/pii.js` | optional; 32 bytes (base64 or hex). Required only once a column actually opts into pgcrypto/AES encryption. |
| `APP_URL` | CORS allow-origin in `hardenResponse` | must match the production site origin exactly. |

## JWT secret rotation

`APP_JWT_SECRET` signs every session. Rotating it forces every signed-in
user to log in again, but is otherwise non-breaking. Schedule: every 90
days, or immediately if you suspect a leak.

1. Generate a new secret: `openssl rand -base64 48` (≥32 bytes after b64 decode).
2. In Vercel, add the new value as a *Preview* env var first and deploy a
   preview branch. Confirm sign-in works there.
3. Promote the new value to *Production*. The next deploy invalidates all
   currently-signed JWTs — every active session sees a single 401, which the
   client handles by bouncing to `/login`.
4. Delete the old value. Audit: a row appears in `audit_log` for every
   subsequent login, attesting the rotation took effect.

## Supabase service-key rotation

Higher impact than the JWT rotation — every API call uses this key.

1. In the Supabase dashboard → Project Settings → API → "Generate new
   service_role key". Save the new key but do not remove the old one yet.
2. In Vercel, update `SUPABASE_SERVICE_KEY` to the new value and redeploy.
3. Smoke-test the deploy: log in, render the exec dashboard, edit a CSM,
   confirm `audit_log` records the change.
4. In Supabase, revoke the old key.

## Anthropic key rotation

1. Generate a new key in the Anthropic console.
2. Update `ANTHROPIC_API_KEY` in Vercel and redeploy.
3. Revoke the previous key.
4. Confirm the AI Analyst panel still answers a question.

## PII encryption key

`PII_ENCRYPTION_KEY` is currently optional. When the first column opts
into application-level encryption, this key becomes load-bearing — losing
it makes the encrypted column unrecoverable.

- Generate: `openssl rand -base64 32`
- Store: Vercel env var **and** a separate offline backup (1Password vault,
  hardware token, sealed envelope — pick one).
- Rotation requires a re-encrypt step: read every row with the old key,
  write it back with the new one, and only then remove the old key.
  Document the script when this is first needed.

## CSRF token model

- Cookie auth (`monument.session` HttpOnly) requires `X-CSRF-Token` to
  match the `monument.csrf` cookie on every state-changing request.
  Enforced in `api/_lib/auth.js#checkCsrf`.
- Bearer-token callers (legacy in-flight tabs, server-to-server) are
  exempt — possession of the JWT is itself the CSRF defense.

## Rate limit behavior

- With `UPSTASH_*` env vars set: globally consistent across Vercel
  regions, 60 req / IP / minute by default. Per-scope (login, audit,
  webhook, etc.).
- Without: per-instance in-memory bucket. Acceptable for single-region
  staging; not for production at scale.

## Audit log

- Every config mutation that flows through `/api/db` or the admin
  endpoints lands in `audit_log` with full before/after state.
- Reads are admin-only (enforced in `api/db/[...path].js`).
- Writes never go through the proxy — they're produced server-side via
  the `audited()` wrapper or `writeAudit()` helper.

## Incident response checklist

If you suspect any of the above is compromised:

1. Rotate the affected secret first (instructions above), redeploy.
2. Pull a recent slice of `audit_log` and `claude_usage` (if relevant) and
   look for unexpected actors or sudden volume.
3. Run `/api/admin/gdpr/export` for any subject email mentioned in the
   incident — preserves a snapshot before further changes.
4. File a Linear ticket with the timeline. Date everything.
