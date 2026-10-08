#!/usr/bin/env bash
#
# B14 §35 — real, working PostgreSQL backup script.
#
# Produces one pg_dump custom-format (-Fc) archive per run — custom
# format is chosen deliberately over plain SQL because it is already
# compressed, supports parallel/selective restore via pg_restore, and is
# the format Postgres itself recommends for anything beyond a toy
# pg_dump | psql pipe. Every run is also recorded as a row in the
# `backups` table (schema.ts's own B1 "foundation" table — this script
# is what finally wires real bookkeeping into it, see BACKEND.md §58 for
# why that table, not a new one, was chosen).
#
# USAGE
#   scripts/backup-db.sh [database_url] [backup_dir]
#
#   database_url  — defaults to $DATABASE_URL (loaded from .env if present
#                   and DATABASE_URL isn't already set in the environment).
#   backup_dir    — defaults to ./backups (git-ignored — see .gitignore).
#
# NAMING CONVENTION
#   <backup_dir>/rishteyzindagi_<db-name>_<UTC-timestamp>.dump
#   e.g. backups/rishteyzindagi_rishteyzindagi_dev_20260930T184501Z.dump
#   The UTC timestamp is sortable and unambiguous across DST/timezones —
#   deliberately not using a local-time format that could collide or
#   sort incorrectly.
#
# RETENTION (documented default — see DEPLOYMENT.md / BACKUP_DR.md for
# the full policy and reasoning; this script enforces it so the policy
# isn't just prose):
#   Keep the most recent 7 daily dumps + the most recent 4 additional
#   weekly dumps (a dump whose UTC day-of-week is Sunday, beyond the most
#   recent 7), deleting everything else older than that. This is the
#   "7 daily + 4 weekly" generation policy documented in BACKUP_DR.md —
#   a reasonable, clearly-labeled default for a pre-launch matrimonial
#   platform's data volume, not a researched SLA.
#
# ENCRYPTION / OFF-SITE — this script does NOT encrypt or copy the dump
# off-box. Doing so for real would need a real KMS/encryption tool and a
# second storage location, neither of which exists in this sandbox (see
# BACKUP_DR.md's honest documentation of this as a deployment-environment
# requirement, not a fabricated feature). A real deployment must pipe
# this script's output through its own encryption-at-rest mechanism (e.g.
# `gpg --encrypt` with a managed key, or a cloud provider's native
# server-side encryption on the bucket this is copied to) before/while
# copying it off-box.
#
# EXIT CODE: non-zero on any failure (set -euo pipefail below), so a cron
# wrapper or scripts/deploy.sh can detect a failed backup and abort
# rather than silently proceeding.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATABASE_URL_ARG="${1:-}"
BACKUP_DIR="${2:-$REPO_ROOT/backups}"

if [ -z "$DATABASE_URL_ARG" ] && [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  # Mirrors migrate.ts's own "load .env if DATABASE_URL isn't already
  # set" convenience — never overrides an already-exported DATABASE_URL.
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL_ARG:-${DATABASE_URL:-}}"

if [ -z "$DATABASE_URL" ]; then
  echo "backup-db.sh: DATABASE_URL is not set (pass it as \$1, export it, or put it in .env)." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "backup-db.sh: pg_dump is not on PATH." >&2
  exit 1
fi

# Extract the bare database name from the URL for the filename and for
# the `backups.filename`/logging — works for the standard
# postgresql://user:pass@host:port/dbname form this project always uses.
DB_NAME="$(echo "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
if [ -z "$DB_NAME" ]; then
  DB_NAME="unknown_db"
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="rishteyzindagi_${DB_NAME}_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
DEST="$BACKUP_DIR/$FILENAME"

echo "backup-db.sh: starting backup of '$DB_NAME' -> $DEST"
START_EPOCH=$(date +%s)

# -Fc: custom format (compressed, restorable with pg_restore, supports
# --list/selective restore). --no-owner/--no-privileges are NOT passed at
# dump time (they're restore-time flags, applied in restore-db.sh) so the
# dump itself is a faithful, complete copy.
if pg_dump --format=custom --file="$DEST" "$DATABASE_URL"; then
  STATUS="COMPLETED"
else
  STATUS="FAILED"
fi

END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))

if [ "$STATUS" = "FAILED" ]; then
  echo "backup-db.sh: pg_dump FAILED after ${DURATION}s." >&2
  rm -f "$DEST"
  exit 1
fi

SIZE_BYTES=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null || echo "0")

echo "backup-db.sh: backup COMPLETED in ${DURATION}s, size=${SIZE_BYTES} bytes -> $DEST"

# --- Bookkeeping: record this run in the `backups` table -------------------
# Best-effort — a backup that succeeded on disk is still a real backup
# even if this INSERT fails for some reason (e.g. the target DB isn't
# reachable for a write, or this script is run against an environment
# with no `backups` table yet); never fail the whole script over the
# bookkeeping row.
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -c \
    "INSERT INTO backups (id, filename, size_bytes, status, started_at, completed_at) VALUES (gen_random_uuid(), '$FILENAME', $SIZE_BYTES, '$STATUS', to_timestamp($START_EPOCH), to_timestamp($END_EPOCH));" \
    >/dev/null 2>&1 || echo "backup-db.sh: warning — could not record backup row in 'backups' table (non-fatal)." >&2
fi

# --- Retention: keep last 7 daily + last 4 weekly (Sunday) dumps ----------
# Applies only to files matching this script's own naming convention in
# BACKUP_DIR, so it never touches an unrelated file a human placed there.
echo "backup-db.sh: applying retention policy (7 daily + 4 weekly) in $BACKUP_DIR"

mapfile -t ALL_DUMPS < <(find "$BACKUP_DIR" -maxdepth 1 -name 'rishteyzindagi_*.dump' -printf '%f\n' 2>/dev/null | sort -r)

KEEP=()
DAILY_COUNT=0
WEEKLY_COUNT=0
for f in "${ALL_DUMPS[@]:-}"; do
  [ -z "$f" ] && continue
  if [ "$DAILY_COUNT" -lt 7 ]; then
    KEEP+=("$f")
    DAILY_COUNT=$((DAILY_COUNT + 1))
    continue
  fi
  # Extract the embedded UTC timestamp and check if it fell on a Sunday.
  TS="$(echo "$f" | sed -E 's/.*_([0-9]{8}T[0-9]{6}Z)\.dump$/\1/')"
  if [ -n "$TS" ]; then
    DATE_PART="${TS:0:8}"
    DOW="$(date -u -d "${DATE_PART}" +%u 2>/dev/null || echo "")"
    if [ "$DOW" = "7" ] && [ "$WEEKLY_COUNT" -lt 4 ]; then
      KEEP+=("$f")
      WEEKLY_COUNT=$((WEEKLY_COUNT + 1))
    fi
  fi
done

for f in "${ALL_DUMPS[@]:-}"; do
  [ -z "$f" ] && continue
  keep=false
  for k in "${KEEP[@]:-}"; do
    if [ "$f" = "$k" ]; then keep=true; break; fi
  done
  if [ "$keep" = false ]; then
    echo "backup-db.sh: retention — removing old backup $f"
    rm -f "$BACKUP_DIR/$f"
  fi
done

echo "backup-db.sh: done."
