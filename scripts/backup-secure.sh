#!/usr/bin/env bash
#
# PCP section J — encrypted, optionally off-box PostgreSQL backup.
#
# Additive to (and independent of) the frozen scripts/backup-db.sh, which still works
# unchanged for plain local dumps. This script:
#   1. pg_dump (custom format) into a private temp file (umask 077)
#   2. ENCRYPTS it (gpg, AES-256) — it refuses to produce an unencrypted backup unless
#      you explicitly set BACKUP_ALLOW_UNENCRYPTED=true
#   3. writes <name>.sha256 and deletes the plaintext dump
#   4. ships it off the box (BACKUP_OFFSITE=dir | s3), if requested
#   5. records a row in the `backups` table and applies LOCAL retention (7 daily + 4 weekly)
#
# SETTINGS (environment; none are ever printed or written to any artifact)
#   DATABASE_URL                    required (or pass as $1)
#   BACKUP_DIR                      default ./backups  ($2)
#   BACKUP_ENCRYPTION               passphrase (default) | recipient | none
#   BACKUP_PASSPHRASE_FILE          file containing the passphrase (mode must be 600/400) — for "passphrase"
#   BACKUP_GPG_RECIPIENT            public-key id/email in your gpg keyring — for "recipient"
#   BACKUP_ALLOW_UNENCRYPTED=true   required for BACKUP_ENCRYPTION=none (not recommended)
#   BACKUP_OFFSITE                  none (default) | dir | s3
#   BACKUP_OFFSITE_DIR              target directory for "dir" (a mounted NFS/remote disk, another volume)
#   BACKUP_S3_*                     see scripts/backup-offsite.ts for "s3"
#
# EXIT CODES: 0 ok | 1 backup/encryption failed | 2 local backup OK but OFF-BOX COPY FAILED
#             (the local encrypted backup is kept; do NOT treat this run as off-box protected)
#             | 3 configuration error
#
# HONEST STATUS: off-box delivery is only as real as the destination you configure. This
# script prints "OFFSITE: NOT CONFIGURED" when BACKUP_OFFSITE=none so a run is never
# mistaken for an off-box backup. Nothing here has been run against a real remote bucket.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_URL="${1:-${DATABASE_URL:-}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
MODE="${BACKUP_ENCRYPTION:-passphrase}"
OFFSITE="${BACKUP_OFFSITE:-none}"

die() { echo "backup-secure.sh: $1" >&2; exit "${2:-3}"; }

[ -n "$DATABASE_URL" ] || die "DATABASE_URL is not set."
command -v pg_dump >/dev/null || die "pg_dump is not on PATH."
case "$MODE" in
  passphrase)
    command -v gpg >/dev/null || die "gpg is not on PATH."
    [ -n "${BACKUP_PASSPHRASE_FILE:-}" ] || die "BACKUP_PASSPHRASE_FILE is not set (BACKUP_ENCRYPTION=passphrase)."
    [ -s "$BACKUP_PASSPHRASE_FILE" ] || die "BACKUP_PASSPHRASE_FILE is missing or empty."
    PERM="$(stat -c %a "$BACKUP_PASSPHRASE_FILE" 2>/dev/null || stat -f %Lp "$BACKUP_PASSPHRASE_FILE")"
    case "$PERM" in 400|600) ;; *) die "BACKUP_PASSPHRASE_FILE must have mode 600 or 400 (is $PERM).";; esac
    [ "$(wc -c < "$BACKUP_PASSPHRASE_FILE")" -ge 16 ] || die "the passphrase must be at least 16 characters."
    ;;
  recipient)
    command -v gpg >/dev/null || die "gpg is not on PATH."
    [ -n "${BACKUP_GPG_RECIPIENT:-}" ] || die "BACKUP_GPG_RECIPIENT is not set (BACKUP_ENCRYPTION=recipient)."
    ;;
  none)
    [ "${BACKUP_ALLOW_UNENCRYPTED:-}" = "true" ] || die "refusing to write an unencrypted backup (set BACKUP_ALLOW_UNENCRYPTED=true to override)."
    ;;
  *) die "BACKUP_ENCRYPTION must be passphrase, recipient or none." ;;
esac
case "$OFFSITE" in
  none) ;;
  dir) { [ -n "${BACKUP_OFFSITE_DIR:-}" ] && [ -d "$BACKUP_OFFSITE_DIR" ]; } || die "BACKUP_OFFSITE_DIR must be an existing directory." ;;
  s3) command -v npx >/dev/null || die "npx is required for BACKUP_OFFSITE=s3." ;;
  *) die "BACKUP_OFFSITE must be none, dir or s3." ;;
esac

DB_NAME="$(echo "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
[ -n "$DB_NAME" ] || DB_NAME="unknown_db"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="rishteyzindagi_${DB_NAME}_${TIMESTAMP}.dump"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
TMP_PLAIN="$(mktemp "$BACKUP_DIR/.plain.XXXXXX")"
GPG_HOME=""
cleanup() { rm -f "$TMP_PLAIN"; if [ -n "$GPG_HOME" ]; then rm -rf "$GPG_HOME"; fi; return 0; }
trap cleanup EXIT

START_EPOCH=$(date +%s)
echo "backup-secure.sh: dumping '$DB_NAME'"
pg_dump --format=custom --file="$TMP_PLAIN" "$DATABASE_URL" || { echo "backup-secure.sh: pg_dump FAILED" >&2; exit 1; }

case "$MODE" in
  passphrase)
    FINAL="$BACKUP_DIR/$BASE.gpg"
    GPG_HOME="$(mktemp -d)"
    GNUPGHOME="$GPG_HOME" gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 --compress-algo none -o "$FINAL" "$TMP_PLAIN" || { rm -f "$FINAL"; echo "backup-secure.sh: encryption FAILED" >&2; exit 1; }
    ;;
  recipient)
    FINAL="$BACKUP_DIR/$BASE.gpg"
    gpg --batch --yes --quiet --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --encrypt --cipher-algo AES256 --compress-algo none \
      -o "$FINAL" "$TMP_PLAIN" || { rm -f "$FINAL"; echo "backup-secure.sh: encryption FAILED" >&2; exit 1; }
    ;;
  none)
    FINAL="$BACKUP_DIR/$BASE"
    cp "$TMP_PLAIN" "$FINAL"
    echo "backup-secure.sh: WARNING — this backup is NOT encrypted." >&2
    ;;
esac
rm -f "$TMP_PLAIN"

( cd "$BACKUP_DIR" && sha256sum "$(basename "$FINAL")" > "$(basename "$FINAL").sha256" )
SIZE_BYTES=$(stat -c%s "$FINAL" 2>/dev/null || stat -f%z "$FINAL")
END_EPOCH=$(date +%s)
echo "backup-secure.sh: created $(basename "$FINAL") (${SIZE_BYTES} bytes, $((END_EPOCH - START_EPOCH))s), encryption=$MODE"

# --- off-box copy -----------------------------------------------------------
OFFSITE_RESULT="NOT CONFIGURED"
EXIT_CODE=0
case "$OFFSITE" in
  dir)
    if cp "$FINAL" "$BACKUP_OFFSITE_DIR/" && cp "$FINAL.sha256" "$BACKUP_OFFSITE_DIR/" \
       && ( cd "$BACKUP_OFFSITE_DIR" && sha256sum -c "$(basename "$FINAL").sha256" >/dev/null 2>&1 ); then
      OFFSITE_RESULT="COPIED to directory (checksum verified at destination)"
    else
      OFFSITE_RESULT="FAILED (directory copy)"; EXIT_CODE=2
    fi ;;
  s3)
    if ( cd "$REPO_ROOT" && npx --no-install tsx scripts/backup-offsite.ts put "$FINAL" ); then
      OFFSITE_RESULT="UPLOADED to S3-compatible bucket (size verified by HEAD)"
    else
      OFFSITE_RESULT="FAILED (S3 upload)"; EXIT_CODE=2
    fi ;;
esac
echo "backup-secure.sh: OFFSITE: $OFFSITE_RESULT"

# --- bookkeeping ------------------------------------------------------------
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -c \
    "INSERT INTO backups (id, filename, size_bytes, status, started_at, completed_at) VALUES (gen_random_uuid(), '$(basename "$FINAL")', $SIZE_BYTES, 'COMPLETED', to_timestamp($START_EPOCH), to_timestamp($END_EPOCH));" \
    >/dev/null 2>&1 || echo "backup-secure.sh: warning — could not record the backups row (non-fatal)." >&2
fi

# --- local retention: newest 7 + up to 4 Sunday copies, only this script's own files -----
mapfile -t ALL < <(find "$BACKUP_DIR" -maxdepth 1 -name 'rishteyzindagi_*.dump.gpg' -printf '%f\n' 2>/dev/null | sort -r)
DAILY=0; WEEKLY=0
for f in "${ALL[@]:-}"; do
  [ -z "$f" ] && continue
  keep=false
  if [ "$DAILY" -lt 7 ]; then keep=true; DAILY=$((DAILY + 1))
  else
    TS="$(echo "$f" | sed -E 's/.*_([0-9]{8})T[0-9]{6}Z\.dump\.gpg$/\1/')"
    DOW="$(date -u -d "$TS" +%u 2>/dev/null || echo "")"
    if [ "$DOW" = "7" ] && [ "$WEEKLY" -lt 4 ]; then keep=true; WEEKLY=$((WEEKLY + 1)); fi
  fi
  if [ "$keep" = false ]; then
    echo "backup-secure.sh: retention — removing $f"
    rm -f "$BACKUP_DIR/$f" "$BACKUP_DIR/$f.sha256"
  fi
done

if [ "$EXIT_CODE" -ne 0 ]; then echo "backup-secure.sh: local backup is kept but the OFF-BOX copy FAILED — this run is NOT off-box protected." >&2; fi
echo "backup-secure.sh: done."
exit "$EXIT_CODE"
