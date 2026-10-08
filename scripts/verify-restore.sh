#!/usr/bin/env bash
#
# PCP section J — proves a backup file is actually restorable.
#
#   scripts/verify-restore.sh <backup file (.dump | .dump.gpg)>
#
# Steps: checksum (if <file>.sha256 exists) -> decrypt to a private temp file -> pg_restore --list
# -> restore into a brand-new THROWAWAY database -> sanity checks -> drop the throwaway database.
# It never touches an existing database: the scratch name is generated, and creation fails if it exists.
#
# SETTINGS
#   VERIFY_ADMIN_DATABASE_URL   connection URL of a role that may CREATE/DROP DATABASE (e.g. .../postgres)
#   BACKUP_PASSPHRASE_FILE      passphrase file for passphrase-encrypted backups
#                               (recipient-encrypted backups need the private key in your gpg keyring)
#   VERIFY_MIN_TABLES           default 50 — fewer public tables than this fails the check
#   VERIFY_REQUIRED_TABLES      default "users memberships payments audit_logs admin_users"
#
# EXIT: 0 verified | 1 verification FAILED | 3 configuration error

set -euo pipefail
umask 077

FILE="${1:-}"
die() { echo "verify-restore.sh: $1" >&2; exit "${2:-3}"; }
{ [ -n "$FILE" ] && [ -f "$FILE" ]; } || die "usage: verify-restore.sh <backup file>"
[ -n "${VERIFY_ADMIN_DATABASE_URL:-}" ] || die "VERIFY_ADMIN_DATABASE_URL is not set."
for c in pg_restore psql; do command -v "$c" >/dev/null || die "$c is not on PATH."; done

MIN_TABLES="${VERIFY_MIN_TABLES:-50}"
REQUIRED="${VERIFY_REQUIRED_TABLES:-users memberships payments audit_logs admin_users}"
WORK="$(mktemp -d)"
SCRATCH_DB="rz_verify_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
SCRATCH_CREATED=false
GPG_HOME=""
cleanup() {
  if [ "$SCRATCH_CREATED" = true ]; then
    if psql "$VERIFY_ADMIN_DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1; then
      echo "verify-restore.sh: scratch database dropped"
    else
      echo "verify-restore.sh: WARNING — could not drop scratch database $SCRATCH_DB" >&2
    fi
  fi
  rm -rf "$WORK"; if [ -n "$GPG_HOME" ]; then rm -rf "$GPG_HOME"; fi; return 0
}
trap cleanup EXIT
fail() { echo "verify-restore.sh: VERIFICATION FAILED — $1" >&2; exit 1; }

# 1. checksum ---------------------------------------------------------------
if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null 2>&1 ) || fail "checksum mismatch (file corrupted or tampered)"
  echo "verify-restore.sh: checksum OK"
else
  echo "verify-restore.sh: no .sha256 file next to the backup — checksum not checked"
fi

# 2. decrypt ----------------------------------------------------------------
DUMP="$WORK/restore.dump"
case "$FILE" in
  *.gpg)
    command -v gpg >/dev/null || die "gpg is not on PATH."
    if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
      [ -s "$BACKUP_PASSPHRASE_FILE" ] || die "BACKUP_PASSPHRASE_FILE is missing or empty."
      GPG_HOME="$(mktemp -d)"
      GNUPGHOME="$GPG_HOME" gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$DUMP" --decrypt "$FILE" 2>/dev/null \
        || fail "decryption failed (wrong passphrase or corrupted file)"
    else
      gpg --batch --yes --quiet -o "$DUMP" --decrypt "$FILE" 2>/dev/null || fail "decryption failed (private key not available?)"
    fi
    echo "verify-restore.sh: decrypted OK" ;;
  *) cp "$FILE" "$DUMP" ;;
esac

# 3. archive structure ------------------------------------------------------
ENTRIES="$(pg_restore --list "$DUMP" 2>/dev/null | grep -vc '^;' || true)"
[ "${ENTRIES:-0}" -gt 0 ] || fail "not a readable pg_dump archive"
echo "verify-restore.sh: archive lists $ENTRIES entries"

# 4. restore into a throwaway database --------------------------------------
psql "$VERIFY_ADMIN_DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\"" || die "cannot create the scratch database (needs CREATEDB)"
SCRATCH_CREATED=true
SCRATCH_URL="$(echo "$VERIFY_ADMIN_DATABASE_URL" | sed -E "s#/[^/?]+(\\?|\$)#/$SCRATCH_DB\\1#")"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$DUMP" >/dev/null 2>"$WORK/restore.err" || { head -5 "$WORK/restore.err" >&2; fail "pg_restore reported errors"; }
echo "verify-restore.sh: restored into scratch database"

# 5. sanity checks ----------------------------------------------------------
TABLES="$(psql "$SCRATCH_URL" -Atq -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
[ "$TABLES" -ge "$MIN_TABLES" ] || fail "only $TABLES public tables restored (expected >= $MIN_TABLES)"
for t in $REQUIRED; do
  [ "$(psql "$SCRATCH_URL" -Atq -c "SELECT to_regclass('public.$t') IS NOT NULL")" = "t" ] || fail "required table '$t' is missing"
done
USERS="$(psql "$SCRATCH_URL" -Atq -c "SELECT count(*) FROM users")"
echo "verify-restore.sh: VERIFIED — $TABLES tables restored; required tables present; users rows: $USERS"
exit 0
