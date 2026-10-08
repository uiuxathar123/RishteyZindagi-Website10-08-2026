#!/usr/bin/env bash
#
# B14 §39 — deterministic deployment orchestration script.
#
# Runs the safe, non-destructive steps of DEPLOYMENT.md's procedure in
# order: backup -> build -> migrate -> verify migration -> health check.
# Steps 7-9 of DEPLOYMENT.md (smoke test / monitor / rollback readiness)
# are deliberately NOT automated here — they depend on what's actually
# observed after a real deploy, not something a script should decide.
#
# CRITICAL: this script is safe to run against local dev (as B14 itself
# did once, to validate it end to end) but MUST NEVER be pointed at a
# real production DATABASE_URL from this sandbox — there is no real
# production environment for this project. Every step it runs is
# genuinely non-destructive (a backup, a build, an idempotent migration
# runner, a read-only migration-table query, an HTTP health check) —
# the caution above is about what DATABASE_URL/PORT you point it at, not
# about anything this script itself does.
#
# Exits non-zero (and stops) on the first failing step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "deploy.sh: DATABASE_URL is not set." >&2
  exit 1
fi

PORT="${PORT:-3100}"
HEALTH_URL="http://localhost:${PORT}/api/v1/health/ready"

echo "=== deploy.sh: step 1/5 — backup ==="
"$SCRIPT_DIR/backup-db.sh" "$DATABASE_URL" "$REPO_ROOT/backups"

echo "=== deploy.sh: step 2/5 — build ==="
npm run build

echo "=== deploy.sh: step 3/5 — migrate ==="
npm run db:migrate

echo "=== deploy.sh: step 4/5 — verify migration ==="
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -c "SELECT hash, created_at FROM drizzle.\"__drizzle_migrations\" ORDER BY created_at DESC LIMIT 1;"
else
  echo "deploy.sh: psql not found — skipping migration-table verification query (non-fatal)." >&2
fi

echo "=== deploy.sh: step 5/5 — health check ==="
PORT="$PORT" npm start &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

echo "deploy.sh: waiting for server to come up on port $PORT..."
READY=false
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/tmp/deploy-health-check.json 2>/dev/null; then
    READY=true
    break
  fi
  sleep 1
done

if [ "$READY" = false ]; then
  echo "deploy.sh: health check FAILED — server never became healthy at $HEALTH_URL" >&2
  exit 1
fi

echo "deploy.sh: health check OK:"
cat /tmp/deploy-health-check.json
echo ""
echo "deploy.sh: all steps completed. Remember: steps 6-8 (smoke test, monitor, rollback readiness) are manual — see DEPLOYMENT.md."
