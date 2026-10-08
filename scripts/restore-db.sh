#!/usr/bin/env bash
#
# B14 §35/§36 — restores a pg_dump custom-format (-Fc) archive (produced
# by scripts/backup-db.sh) into a target database via pg_restore.
#
# SAFETY: this script NEVER creates or drops a database itself — it only
# restores INTO a database that must already exist and that you name
# explicitly. This is deliberate: it makes it structurally impossible for
# a typo'd invocation to silently target the wrong instance by inventing
# a same-named database there. The B14 restore-test proof in
# BACKUP_DR.md always targets a throwaway scratch database created (and
# dropped) by hand for that purpose — never rishteyzindagi_dev or
# rishteyzindagi_test.
#
# USAGE
#   scripts/restore-db.sh <dump_file> <target_database_url>
#
# --clean --if-exists: drops each object before recreating it (safe to
# run against an already-restored or partially-populated target).
# --no-owner --no-privileges: the dump's origin role (e.g. "postgres" on
# the source box) may not exist identically on the restore target — never
# fail a restore over ownership/grant statements that don't apply.

set -euo pipefail

DUMP_FILE="${1:-}"
TARGET_URL="${2:-}"

if [ -z "$DUMP_FILE" ] || [ -z "$TARGET_URL" ]; then
  echo "usage: scripts/restore-db.sh <dump_file> <target_database_url>" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "restore-db.sh: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "restore-db.sh: pg_restore is not on PATH." >&2
  exit 1
fi

echo "restore-db.sh: restoring $DUMP_FILE -> $TARGET_URL"
START_EPOCH=$(date +%s)

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_URL" "$DUMP_FILE"

END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))
echo "restore-db.sh: restore complete in ${DURATION}s."
