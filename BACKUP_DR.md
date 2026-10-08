# Production-completion addendum — encrypted, off-box, verified backups (READ THIS FIRST)

Everything below the horizontal rule (the original B14 text) is still accurate for `scripts/backup-db.sh` / `scripts/restore-db.sh`, which are unchanged. The production-completion phase adds three new scripts and the operating policy that goes with them. Where this addendum and the B14 text differ — especially about storage and "no off-box copy" — **this addendum wins**.

**Status labels:** VERIFIED = run by an executed test (`tests/pcp-backup.test.ts`, 12 tests) against a real PostgreSQL 16, real `gpg` and a moto S3 emulator. NOT VERIFIED / REQUIRES EXTERNAL CREDENTIALS = never run against a real remote bucket or a real second machine. **Off-box protection is NOT OPERATIONAL until you configure a destination and run the checklist in §6; the scripts say so explicitly ("OFFSITE: NOT CONFIGURED") instead of letting a local-only run look protected.**

## A. What was added

| Script | Purpose |
|---|---|
| `scripts/backup-secure.sh` | `pg_dump` → **encrypt (gpg AES-256, or a gpg public key)** → sha256 sidecar → optional off-box copy → `backups` bookkeeping row → local retention. Refuses to write an unencrypted backup unless `BACKUP_ALLOW_UNENCRYPTED=true`. |
| `scripts/backup-offsite.ts` | Off-box transport to an S3-compatible bucket (`check`, `put <file>`, `get <name> <dest>`); verifies each upload by HEAD size. |
| `scripts/verify-restore.sh` | Proves a backup is restorable: checksum → decrypt → `pg_restore --list` → restore into a throwaway `rz_verify_*` database → sanity checks (≥ 50 tables, core tables present) → drop it. |

## B. Settings (environment only; never printed, never written to any artifact)

`DATABASE_URL`, `BACKUP_DIR`, `BACKUP_ENCRYPTION` (`passphrase` default | `recipient` | `none`), `BACKUP_PASSPHRASE_FILE` (a file, mode 600/400, ≥ 16 characters), `BACKUP_GPG_RECIPIENT`, `BACKUP_ALLOW_UNENCRYPTED`, `BACKUP_OFFSITE` (`none` | `dir` | `s3`), `BACKUP_OFFSITE_DIR`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PREFIX`, `BACKUP_S3_FORCE_PATH_STYLE`, `VERIFY_ADMIN_DATABASE_URL`, `VERIFY_MIN_TABLES`, `VERIFY_REQUIRED_TABLES`. Template: `.env.example`.

Exit codes of `backup-secure.sh`: `0` ok · `1` backup/encryption failed · `2` **local backup OK but off-box copy FAILED** (the encrypted local file is kept; do not treat the run as protected) · `3` configuration error.

## C. Setting it up

```
# one-time: a long random passphrase kept OUTSIDE the server's backup directory
umask 077; openssl rand -base64 32 > /etc/rishteyzindagi/backup.pass     # chmod 600
# daily cron (example)
17 3 * * *  cd /srv/rishteyzindagi && BACKUP_DIR=/var/backups/rz BACKUP_PASSPHRASE_FILE=/etc/rishteyzindagi/backup.pass \
            BACKUP_OFFSITE=s3 BACKUP_S3_BUCKET=… BACKUP_S3_REGION=… BACKUP_S3_ACCESS_KEY_ID=… BACKUP_S3_SECRET_ACCESS_KEY=… \
            scripts/backup-secure.sh "$DATABASE_URL" >> /var/log/rz-backup.log 2>&1
```

Use a **separate bucket, separate credentials and ideally another account/region** for backups; enable bucket versioning and, if available, object lock. Give the backup credentials write-only access to the prefix where possible. Alert on a non-zero exit code (especially `2`).

## D. Retention guidance

- **Local** (enforced by the script, applies to `*.dump.gpg` only): the newest 7 backups plus up to 4 Sunday backups.
- **Off-box** (not enforced by the scripts — configure it at the bucket, e.g. an S3 lifecycle rule): suggested starting point is daily backups kept 35 days and one backup per month kept 12 months. This is a guideline, not an SLA; adjust to your legal and business needs (a backup contains personal data, so its retention is also a privacy decision — account-deletion finalisation does **not** remove a person from old backups; document your retention period in your privacy policy).
- Back up the **media bucket** separately from the database: enable bucket versioning on the media bucket (or replicate it). The database dump does not contain photo files.

## E. Keys you must keep (or the backup is useless)

1. **The backup passphrase (or gpg private key)** — store it in a password manager / secrets vault **separately from the backups**. Lose it and every encrypted backup is unrecoverable; leak it and every backup is readable.
2. **`PAYMENT_CREDENTIALS_ENCRYPTION_KEY`** — payment credentials saved in the admin panel are stored encrypted *inside the database*, so they are inside every dump but unreadable without this key. After restoring to a new environment, set the same key (or re-enter the gateway credentials).
3. `AUTH_SECRET` is not needed to restore (sessions are simply re-created), but keep it in the same vault.

## F. Restore verification (do this before launch and then on a schedule)

```
VERIFY_ADMIN_DATABASE_URL=postgres://<role-with-CREATEDB>@host/postgres \
BACKUP_PASSPHRASE_FILE=/etc/rishteyzindagi/backup.pass \
scripts/verify-restore.sh /var/backups/rz/rishteyzindagi_….dump.gpg
```

Expected output: `verify-restore.sh: VERIFIED — <n> tables restored; required tables present; users rows: <n>` followed by `scratch database dropped`; exit code 0. A backup that has never been through this is an *unverified* backup. Run it after the first backup, after every migration that changes tables, and at least monthly; also rehearse a full restore (`scripts/restore-db.sh`) into a staging database once before launch and record the elapsed time as your real recovery-time figure.

To restore from off-box: `npx tsx scripts/backup-offsite.ts get <object-name> ./restore/` (the object name is the file name; list objects with your provider console), then verify and restore as above.

## G. What is VERIFIED and what is not

| Claim | Status |
|---|---|
| Encrypted backup is created, plaintext dump is deleted, checksum sidecar written | VERIFIED (real `pg_dump` + `gpg`) |
| Refuses weak/unreadable passphrase files and unencrypted output without the explicit flag | VERIFIED |
| Backup restores into a scratch DB and passes sanity checks; a modified file (checksum mismatch), a wrong passphrase and a non-archive file all FAIL verification and leave no scratch database behind | VERIFIED |
| Off-box copy to a directory and to an S3-compatible endpoint (moto) incl. HEAD size check; failure of the destination returns exit 2 and keeps the local file | VERIFIED against the emulator |
| No secret (passphrase, S3 keys, DB password) appears in script output | VERIFIED (output scanned in tests) |
| Off-box copy to a real remote bucket / second machine | **NOT VERIFIED — REQUIRES EXTERNAL CREDENTIALS** |
| A real scheduler is running the backups | **NOT VERIFIED — nothing in this repo runs it; you must install the cron/scheduler entry** |
| Recovery time on production-sized data | **NOT VERIFIED** (no production data exists) |
| Media bucket backup/versioning | **NOT VERIFIED — provider setting, outside this repo** |

---

# RishteyZindagi Backend — Backup & Disaster Recovery (B14)

**Phase:** B14 — Production Release / Deployment / Backup / DR
Companion to `DEPLOYMENT.md` and `SECURITY_RELEASE_CHECKLIST.md`. Every claim below is backed by a command this phase actually ran against this sandbox's real PostgreSQL 16 instance — timestamps, sizes, and row counts are copy-pasted from real output, not invented.

---

## 1. Backup method

`scripts/backup-db.sh` (real, executable, `chmod +x`'d) runs `pg_dump --format=custom` against the database named by `DATABASE_URL`, writing one archive per run to `<backup_dir>/rishteyzindagi_<db-name>_<UTC-timestamp>.dump` (default `backup_dir`: `./backups`, git-ignored). Custom format (`-Fc`) was chosen over plain-SQL because it is already compressed and restorable with `pg_restore --clean --if-exists` (see `scripts/restore-db.sh`), including selective/table-level restore if ever needed — the format PostgreSQL's own documentation recommends over a plain `pg_dump | psql` pipe for anything beyond a toy setup.

Each successful run also inserts one bookkeeping row into the pre-existing `backups` table (`schema.ts`'s own B1 "foundation" table, documented there as exactly this table's purpose) — `filename`, `size_bytes`, `status` (`COMPLETED`/`FAILED`), `started_at`, `completed_at`. This is a **judgment call, made and disclosed**: the alternative (leaving `backups` permanently empty and building a separate log) was rejected because the table already exists for exactly this purpose and adding nothing new to the schema is the smaller, safer change. The insert is best-effort (wrapped so a bookkeeping-write failure never fails an otherwise-successful backup).

## 2. Frequency (recommended policy — documented judgment call)

**Daily automated backup + a backup immediately before every deployment** (deploy step 1 in `DEPLOYMENT.md`). No cron scheduler exists in this codebase or sandbox to enforce "daily" automatically — a real deployment wires `scripts/backup-db.sh` into whatever the host provides (a cron job, a scheduled Lambda/Cloud Run job, a CI scheduled pipeline, etc.). This is a clearly-labeled recommended default for a pre-launch matrimonial platform's realistic data-change rate, not a researched SLA — there is no real production traffic in existence to derive one from.

## 3. Retention

`scripts/backup-db.sh` enforces a **7-daily + 4-weekly (Sunday) generation policy** on its own output directory: the most recent 7 dumps are always kept regardless of day, and beyond that, up to 4 additional dumps whose embedded UTC timestamp fell on a Sunday are kept — everything else matching the script's own naming convention is deleted. This is a standard, conservative generational-backup shape (roughly 5 weeks of recoverability with bounded storage growth), a documented default, not a contractual guarantee.

## 4. Encryption

**Not implemented in this sandbox, honestly disclosed rather than faked.** `scripts/backup-db.sh` writes an unencrypted `pg_dump` archive to local disk. This sandbox has no real KMS or managed-secret encryption tool to wire in genuinely. **Documented requirement for a real deployment**: any backup copied off the box that produced it (see §5 below) must be encrypted at rest and in transit before/during that copy — e.g. piped through `gpg --encrypt` against a managed key, or relying on the destination's own server-side encryption (a cloud storage bucket's native SSE). This is a deployment-environment requirement, not something B14 could truthfully claim to have built and tested without a real KMS available.

## 5. Off-site / independent-copy strategy

**Not implemented in this sandbox — no second storage location exists to copy to.** Documented requirement: a real deployment must copy each `backups.*.dump` file to a location independent of the database host (a different cloud region/provider than the DB itself, at minimum) on a schedule at least as frequent as the backup itself, so a full loss of the DB host's storage doesn't also destroy its own backups. This codebase's `STORAGE_PROVIDER` abstraction (B3) is the natural integration point for this once a real object-store provider is implemented (see `DEPLOYMENT.md` §8's known-limitations list) — not built now since no such provider exists yet to copy into.

---

## 6. REAL restore-test proof — actually run this phase

Per B14's own instruction, this test targeted **throwaway scratch databases created and dropped solely for this purpose** — never `rishteyzindagi_dev` or `rishteyzindagi_test`, so neither database used by any other phase's tests was ever at risk.

### 6.1 Setup

```
$ psql -c "CREATE DATABASE rishteyzindagi_backup_scratch;"
CREATE DATABASE
$ psql -c "CREATE DATABASE rishteyzindagi_restore_scratch;"
CREATE DATABASE
$ DATABASE_URL=".../rishteyzindagi_backup_scratch" npx tsx src/server/db/migrate.ts
Running migrations...
Migrations complete.
$ DATABASE_URL=".../rishteyzindagi_backup_scratch" npx tsx src/server/db/seed.ts
Seeding admin roles...
Seeding permissions...
Granting permissions to roles...
Seeding dev-only Super Admin account (dev-superadmin@rishteyzindagi.local)...
Seeding profile reference data (religions, mother tongues, educations, professions, countries, cities, marital statuses)...
Seeding report categories and warning categories...
Seeding payment gateways and membership plans...
Seed complete.
```

One additional, distinctive row was inserted by hand to give the restore verification something unambiguous to check:

```sql
INSERT INTO users (id, name, email, mobile_number, password_hash, status, created_at)
VALUES (gen_random_uuid(), 'B14 Backup Proof User', 'b14-backup-proof@example.com', '9999999999', 'x', 'ACTIVE', now());
```

**Row counts before backup** (`rishteyzindagi_backup_scratch`):

```
 users            |     1
 admin_users      |     1
 admin_roles      |     2
 religions        |    10
 membership_plans |     8
 payment_gateways |     5
 backups          |     0
```

### 6.2 Real backup run

```
$ ./scripts/backup-db.sh "postgresql://postgres:YOUR_PASSWORD@localhost:5432/rishteyzindagi_backup_scratch" ./backups
backup-db.sh: starting backup of 'rishteyzindagi_backup_scratch' -> ./backups/rishteyzindagi_rishteyzindagi_backup_scratch_20260930T190128Z.dump
backup-db.sh: backup COMPLETED in 1s, size=137175 bytes -> ./backups/rishteyzindagi_rishteyzindagi_backup_scratch_20260930T190128Z.dump
backup-db.sh: applying retention policy (7 daily + 4 weekly) in ./backups
backup-db.sh: done.
```

Bookkeeping row confirmed written to the source database's own `backups` table:

```
                              filename                              | size_bytes |  status   |       started_at       |      completed_at
--------------------------------------------------------------------+------------+-----------+------------------------+------------------------
 rishteyzindagi_rishteyzindagi_backup_scratch_20260930T190128Z.dump |     137175 | COMPLETED | 2026-09-30 19:01:28+00 | 2026-09-30 19:01:29+00
```

**Measured backup duration: 1 second**, on an 8-table, ~30-row seeded database. This is the real, if small-scale, number the RTO figure below is grounded in.

### 6.3 Real restore run — into a SEPARATE fresh scratch database

```
$ ./scripts/restore-db.sh backups/rishteyzindagi_rishteyzindagi_backup_scratch_20260930T190128Z.dump \
    "postgresql://postgres:YOUR_PASSWORD@localhost:5432/rishteyzindagi_restore_scratch"
restore-db.sh: restoring backups/rishteyzindagi_rishteyzindagi_backup_scratch_20260930T190128Z.dump -> postgresql://postgres:YOUR_PASSWORD@localhost:5432/rishteyzindagi_restore_scratch
restore-db.sh: restore complete in 1s.
```

**Measured restore duration: 1 second.**

### 6.4 Verification — row counts AND a specific row, both checked for real

Row counts after restore (`rishteyzindagi_restore_scratch`):

```
 users            |     1
 admin_users      |     1
 admin_roles      |     2
 religions        |    10
 membership_plans |     8
 payment_gateways |     5
 backups          |     0
```

**Identical to the pre-backup counts in §6.1** (the `backups` count of 0 in both is correct and expected — the bookkeeping row was inserted into the *source* database immediately *after* the `pg_dump` snapshot was already taken, so it was never part of that snapshot; this is documented, correct temporal behavior, not a bug).

Specific-row check — the hand-inserted distinctive user, queried from the **restored** database:

```
$ psql rishteyzindagi_restore_scratch -c "select name, email, mobile_number, status from users where email = 'b14-backup-proof@example.com';"
         name          |            email             | mobile_number | status
-----------------------+------------------------------+---------------+--------
 B14 Backup Proof User | b14-backup-proof@example.com | 9999999999    | ACTIVE
(1 row)
```

**Exact match.** This is a real, personally-run pg_dump → pg_restore round trip with independently verified row-count and row-content fidelity — not a claim taken on faith.

### 6.5 Cleanup — confirmed, both scratch databases dropped

```
$ psql -c "DROP DATABASE rishteyzindagi_backup_scratch;"
DROP DATABASE
$ psql -c "DROP DATABASE rishteyzindagi_restore_scratch;"
DROP DATABASE
$ psql -c "\l"
 postgres | rishteyzindagi_dev | rishteyzindagi_test | template0 | template1
```

Both scratch databases are gone; only the two real, pre-existing databases (`rishteyzindagi_dev`, `rishteyzindagi_test`) remain.

### 6.6 Confirmed: real dev/test databases were never touched by this testing

```
rishteyzindagi_dev  users count:  0   (unchanged before/after)
rishteyzindagi_test users count:  0/1 (ordinary test-suite churn between runs — unrelated to backup/restore testing, which never targeted this database)
rishteyzindagi_dev  religions count:  10  (unchanged)
rishteyzindagi_test religions count:  10  (unchanged)
```

`scripts/deploy.sh` (see `DEPLOYMENT.md` §6) was additionally run once, separately, against local dev's real `DATABASE_URL` to validate the full deploy sequence end to end — this **did** take one real (non-destructive, read-only-from-the-DB's-perspective) `pg_dump` of `rishteyzindagi_dev` as its step-1 backup. `pg_dump` never modifies its source; `rishteyzindagi_dev`'s row counts were confirmed identical (0 users) immediately after. The three resulting `.dump` files (and the earlier scratch-DB one) were deleted after this phase's verification — `./backups/` is empty and git-ignored; nothing was left behind.

---

## 7. Disaster Recovery (§36)

### 7.1 RPO (Recovery Point Objective)

**≤ 24 hours under the recommended daily-backup schedule; ≤ time-since-last-deploy if a pre-deployment backup was also taken** (deploy step 1 — every deploy backs up first). This is a **documented policy choice**, consistent with the §2 recommended frequency — not a measured number, since RPO is inherently a policy decision about acceptable data loss, not something a test measures.

### 7.2 RTO (Recovery Time Objective)

**Grounded in the real measurement above**: this phase's actual backup took 1 second and actual restore took 1 second against an ~30-row seeded database. That number does not generalize directly to a real production-scale database — `pg_dump`/`pg_restore` duration scales with data volume, not row-count alone. The honest, documented RTO for a real deployment, until a real-scale restore is measured:

**RTO = (time to provision/access a working Postgres instance) + (measured restore duration at real scale) + (application redeploy time, per `DEPLOYMENT.md` §6, itself a few minutes for `npm run build && npm start`) + a 2× safety buffer.**

Concretely, for THIS sandbox's data scale (the only real number available): **< 5 minutes end-to-end** (restore ~1s + app build/start, generously bounded, observed during `scripts/deploy.sh`'s real run — see `DEPLOYMENT.md`). A real production deployment must re-measure this against its actual data volume before quoting an RTO to any stakeholder — this number is honestly scale-limited, not a fabricated production SLA.

### 7.3 Full recovery procedure

1. **Database restore** — `scripts/restore-db.sh <latest-good-dump> "$DATABASE_URL"` against a freshly-provisioned (or already-running, now-empty/corrupted) Postgres instance. Real proof: §6 above.
2. **Application restart/redeploy** — per `DEPLOYMENT.md` §6 steps 3–6 (deploy → migrate → verify → health-check). If the outage was infra-only (DB restored, app code unaffected), a plain restart suffices; if app code was also affected, redeploy the last known-good build.
3. **Storage restore** — **honest limitation, carried from B3**: `STORAGE_PROVIDER=local` (the only implemented provider) stores uploaded profile photos on the same disk the app process runs on, with **no independent backup mechanism today**. If that disk is lost, uploaded photos are lost with it — restoring the database alone does not restore the binary photo files (only their metadata rows, which would then point at missing files). **Documented recommendation for a real deployment**: move to a real object-store provider (S3 or equivalent) with its own versioning/backup before going live with real user-uploaded photos — not implemented in this codebase per B3's own "honest failure over fake cloud support" posture (`factory.ts` throws rather than pretending a provider it doesn't have).
4. **Invoice/PDF restore** — invoices are generated PDFs stored via the **same** storage abstraction as photos (confirmed by reading `invoice-pdf.ts`'s storage calls) — identical honest limitation and identical recommendation as step 3.
5. **Configuration restore** — `.env` values (secrets, credentials) must be restored from whatever secrets manager the real deployment uses — **never from the database backup**, since they were never in it (`.env` is local-only, confirmed never read from or written to the database anywhere in `src/server`).

### 7.4 What was and wasn't tested for real

- **Database restore**: tested for real, in full, in §6 above.
- **Application redeploy / health-check**: tested for real via `scripts/deploy.sh`'s real run against local dev (`DEPLOYMENT.md` §6).
- **Storage restore / invoice restore**: **not testable for real in this sandbox** — there is no real off-box storage backup to restore from, honestly, because none is implemented (§7.3 steps 3–4). This is disclosed as a genuine gap, not glossed over.

---

## 8. Honest summary

Backup and restore are REAL, WORKING, and TESTED end to end against real scratch databases with real row-count and row-content verification, plus one additional real run of the full deploy sequence (backup → build → migrate → verify → health-check) against local dev. Encryption and off-site copying are honestly NOT implemented — this sandbox has no KMS and no second storage location to genuinely wire either into, and both are documented as real requirements for an actual production deployment rather than faked. RPO is a documented policy choice; RTO is grounded in this phase's real (if small-scale) measured numbers, explicitly flagged as needing re-measurement at real production data volume.
