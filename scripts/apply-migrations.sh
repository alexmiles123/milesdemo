#!/usr/bin/env bash
# Apply Monument migrations to Supabase in order.
#
# Usage:
#   SUPABASE_DB_URL="postgres://postgres:<password>@db.<project>.supabase.co:5432/postgres" \
#     ./scripts/apply-migrations.sh
#
# Find SUPABASE_DB_URL: Supabase dashboard → Project Settings → Database →
# Connection string → URI (use the "direct" connection, not the pooler, for DDL).
#
# All migration files are idempotent (IF NOT EXISTS / CREATE OR REPLACE), so
# re-running this against a populated DB is safe.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "error: SUPABASE_DB_URL is not set." >&2
  echo "export SUPABASE_DB_URL=\"postgres://postgres:<password>@db.<project>.supabase.co:5432/postgres\"" >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH. Install PostgreSQL client tools." >&2
  exit 2
fi

cd "$(dirname "$0")/.."

shopt -s nullglob
files=(migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "error: no migration files found in migrations/" >&2
  exit 2
fi

for f in "${files[@]}"; do
  echo "==> applying $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo
echo "all migrations applied."
