# RishteyZindagi Backend — B16: Production Infrastructure, Deployment & Real-Integration Foundation

**Phase:** B16 — Production Infrastructure, Deployment & Real-Integration Foundation
**Status:** This is an **AUDIT / DESIGN DOCUMENT phase**, not a new feature phase. B1-B15 business logic is frozen and untouched. Every finding below is backed by a file this phase actually read or a command this phase actually ran — never a restatement taken on faith. **No real hosting, no real deployment, no real payment transaction, no real OTP send, and no database reset/rotation was ever performed from this sandbox.** Where something genuinely does not exist here (a hosting target, a cloud storage provider, CI/CD, real payment credentials), this document says so explicitly as NOT CONFIGURED / NOT APPLICABLE, never papered over.

Companion documents already at the repo root, re-verified (not re-written) by this phase where their claims overlap: `DEPLOYMENT.md`, `BACKUP_DR.md`, `SECURITY_RELEASE_CHECKLIST.md` (all B14), `API_REFERENCE.md`, `PERFORMANCE_REPORT.md`, `QA_TRACEABILITY_MATRIX.md`, `B15_FINAL_REPORT.md`, `B15_KNOWN_LIMITATIONS.md`, `B15_RELEASE_READINESS_MATRIX.md`, `B15_RELEASE_CHECKLIST.md`.

---

## B16.1 Infrastructure architecture

**Current shape, confirmed by reading every file listed below (not assumed):**

- **Framework**: Next.js 14.2.35 (App Router), `next.config.js` has no `headers()`/`rewrites()`/`redirects()` — a deliberate B10 change (CORS/security headers moved to `src/middleware.ts` because a static config value cannot vary per-request; see that file's own header comment, confirmed by reading both files).
- **Runtime**: a single long-running Node.js process (`next start`). No edge-function-only routes, no serverless-function-per-route split — every `/api/v1/*` route is an ordinary Next.js Route Handler running in the Node runtime, **except** `src/middleware.ts` itself, which Next.js always runs in the Edge runtime regardless of app code (confirmed by that file's own comment on why it reads `process.env.ALLOWED_ORIGINS` directly instead of through `getEnv()`).
- **Database**: PostgreSQL 16 (confirmed via `pg_isready`/`psql` this session), accessed exclusively through one shared `pg.Pool` + Drizzle ORM client (`src/server/db/client.ts`) — `max: 10` connections, cached on `globalThis` outside production to survive Next.js dev hot-reload.
- **Migrations**: Drizzle Kit, 11 SQL migration files (`drizzle/0000`–`0010`), applied via `src/server/db/migrate.ts`, which self-manages a `drizzle."__drizzle_migrations"` tracking table. No separate migration tool, no raw hand-run SQL.
- **Storage**: a provider-abstraction (`src/server/modules/storage/factory.ts` + `storage.types.ts`), with exactly ONE implemented provider (`local-disk.provider.ts`, writes under `.storage-local/`). Any other `STORAGE_PROVIDER` value throws `ServiceUnavailableError` rather than silently falling back — confirmed by reading `factory.ts`.
- **No Dockerfile, no container image, no Kubernetes/Helm manifest, no CI/CD YAML of any kind exists anywhere in this repository** — confirmed: `find . -iname "Dockerfile*" -o -iname "*.yml" -o -iname "*.yaml"` (excluding `node_modules`) returns nothing under version-controllable paths. This matches the context already established for this phase.
- **Process orchestration**: none built — `scripts/deploy.sh` is a real, runnable shell script that sequences backup → build → migrate → verify → health-check, but nothing in this repo triggers it automatically, restarts a crashed process, or load-balances across instances. A real deployment supplies its own process supervisor (systemd, a PaaS's own restart policy, a container orchestrator, etc.) — this codebase is agnostic to which.
- **Logging**: structured, one JSON line per request (`src/server/lib/logger.ts`), to stdout/stderr only (`console.log`/`console.error`) — no log file, no log-shipping agent, no APM/tracing SDK anywhere in `package.json`'s dependencies (confirmed by reading the full dependency list).

**Architecture diagram (text, since this is a Markdown deliverable):**

```
                      ┌─────────────────────────┐
  HTTPS (TLS           │   Hosting platform       │   ← NOT CHOSEN (B16.13 /
  terminated here,      │   load balancer / proxy  │     MANUAL DECISION
  not in-app)            │   (terminates TLS)       │     REQUIRED)
                      └────────────┬─────────────┘
                                   │ HTTP (plain, internal)
                      ┌────────────▼─────────────┐
                      │  src/middleware.ts        │  ← Edge runtime
                      │  (CORS + security headers)│
                      └────────────┬─────────────┘
                                   │
                      ┌────────────▼─────────────┐
                      │  Next.js route handlers   │  ← Node runtime,
                      │  (src/app/api/v1/*)       │    single process,
                      │  src/server/* (service/   │    `next start`
                      │  repository/middleware)   │
                      └──┬───────────┬────────────┘
                         │           │
             ┌───────────▼───┐   ┌───▼─────────────────┐
             │ PostgreSQL 16  │   │ .storage-local/      │  ← local disk only;
             │ (pg.Pool,      │   │ (local-disk provider)│    NOT independently
             │  max:10)       │   │                       │    backed up (B16.4)
             └────────────────┘   └───────────────────────┘

  External (none wired to a real vendor SDK — every isConfigured()==true
  path still throws honestly at send()/createOrder() time — B16.5):
  OTP email/SMS/WhatsApp · push · Razorpay/Cashfree/PayU/PhonePe/Paytm
```

---

## B16.2 Environment variable matrix

Built by reading `src/server/config/env.ts`'s real zod schema in full, plus `src/middleware.ts`'s one direct `process.env` read (`ALLOWED_ORIGINS`, deliberately outside `getEnv()` — Edge-runtime scoped, documented in that file). This supersedes nothing in `DEPLOYMENT.md` §2 (re-confirmed identical this phase) — repeated here in the B16-specified column shape.

| Var | Purpose | Required? | Secret? | Current implementation | Production value required? | Safe to expose to frontend? | Validation |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Drives every dev/mock-provider double-guard | No (default `development`) | No | zod enum, default applied | **Yes — must be `"production"`** | No (server-only) | zod enum |
| `DATABASE_URL` | Postgres connection string | **Yes** | **Yes** | `pg.Pool({ connectionString })`, `max: 10` | **Yes — real managed/self-run Postgres 16** | No | zod non-empty string; fails fast if missing |
| `APP_URL` | Informational base URL | No | No | Unused for redirects/links in any server code path found by grep | Recommended — set to real domain once chosen | Yes | none (free string) |
| `API_URL` | Informational base URL | No | No | Same as above | Recommended | Yes | none |
| `AUTH_SECRET` | HMAC key, device-session tokens at rest (not a JWT key) | **Yes** | **Yes** | zod non-empty string | **Yes — long random value, never the `.env.example` placeholder** | No | zod non-empty; **B16 adds**: `check:prod-env` flags known placeholder values |
| `SESSION_TTL_HOURS` | Session lifetime | No (default 720) | No | zod coerced int | Review (720h = 30 days; a policy choice, not a bug) | No | zod positive int |
| `SEED_DEV_SUPER_ADMIN` | Dev-only seed toggle | No (default false) | No | Only honored when `NODE_ENV=development` | **Must be `false`/unset** | No | zod transform; **B16 `check:prod-env` flags `true`** |
| `SEED_DEV_SUPER_ADMIN_EMAIL` / `_PASSWORD` | Dev seed credentials | No | `_PASSWORD` yes | Only used with above | Never set in production | No | none |
| `ALLOWED_ORIGINS` | CORS allowlist | No (empty = allow-all) | No | Read directly in `src/middleware.ts` (Edge runtime), not via `getEnv()` | **Yes — set to the real frontend/Android origin(s) once known** | Yes (it's a policy value, not a secret) | manual comma-split, no schema (documented in-file) |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` | OTP email channel | No | `_API_KEY` yes | `isConfigured()`-at-request-time; `send()` throws honestly (no real vendor SDK wired in) | Only if email OTP/notifications are the launch channel | No | none beyond presence |
| `SMS_PROVIDER` / `SMS_API_KEY` | OTP SMS channel | No | `_API_KEY` yes | Same pattern | Only if SMS is the launch channel | No | none |
| `WHATSAPP_PROVIDER` / `WHATSAPP_API_KEY` | OTP WhatsApp channel | No | `_API_KEY` yes | Same pattern | Only if WhatsApp is the launch channel | No | none |
| `PUSH_PROVIDER` / `PUSH_API_KEY` | Push notifications | No | `_API_KEY` yes | Same pattern (B7) | Only if push is launched | No | none |
| `STORAGE_PROVIDER` | Photo/invoice storage backend | No (default `"local"`) | No | Only `"local"` implemented; anything else throws `ServiceUnavailableError` | **Yes for real launch — `"local"` has no independent backup (B16.4)** | No | string; factory throws on unknown value |
| `STORAGE_BUCKET` | Reserved for a future real provider | No | No | Unused by the only implemented provider | N/A until a real provider exists | No | none |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | AES-256-GCM key, encrypts gateway creds at rest | No | **Yes** | `crypto.ts` throws `ServiceUnavailableError` if unset/malformed when a credential save is attempted | **Yes before any real gateway credential can be saved** | No | regex-checked at use time (64-hex); **B16 `check:prod-env` also checks it** |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` | Razorpay credentials | No | **Yes** | `isConfigured()` only flips true/false; `createOrder`/`verifyPayment` always throw (no real SDK wired in — B16.5) | Needed before Razorpay can process real money, **and** real SDK integration code must still be written | No | none beyond presence |
| `CASHFREE_APP_ID` / `_SECRET_KEY` | Cashfree credentials | No | **Yes** | Same pattern | Same caveat | No | none |
| `PAYU_MERCHANT_KEY` / `_SALT` | PayU credentials | No | **Yes** | Same pattern | Same caveat | No | none |
| `PHONEPE_MERCHANT_ID` / `_SALT_KEY` | PhonePe credentials | No | **Yes** | Same pattern | Same caveat | No | none |
| `PAYTM_MERCHANT_ID` / `_MERCHANT_KEY` | Paytm credentials | No | **Yes** | Same pattern | Same caveat | No | none |
| `GST_RATE_PERCENT` | Invoice tax rate placeholder | No (default 18) | No | zod coerced number, 0–100 | **Confirm real applicable rate before real launch — explicitly not researched tax law** | Yes | zod range-checked |

**Orphaned variable, re-confirmed this phase**: `PAYMENT_ENVIRONMENT` still appears in the live sandbox `.env` (not `.env.example`, which `DEPLOYMENT.md` §2 already cleaned up) but is read by zero source files (grep-confirmed again this phase) — harmless, zod silently ignores unknown keys (`safeParse` on a non-`.strict()` object), not a functional issue, just noted for completeness.

---

## B16.3 Database production readiness

Re-confirmed by reading `src/server/db/client.ts`, `migrate.ts`, `drizzle.config.ts`, and the full `drizzle/` directory listing this phase (11 SQL files `0000`–`0010`, matching `meta/_journal.json`'s own record, matching `DEPLOYMENT.md` §4's claim — no drift found).

- **Connection pooling**: `pg.Pool({ connectionString, max: 10 })`. `max: 10` is hard-coded, not env-configurable — a real deployment horizontally scaled to N instances needs either a lower per-instance `max` or a pooler (PgBouncer) in front, exactly as `DEPLOYMENT.md` §4 already documents. **Not changed by B16** (a tuning value with no single "correct" default absent real traffic data — changing it now would be exactly the "new infrastructure nobody asked for" restraint B13 established).
- **TLS/SSL to Postgres — audited finding, not previously written down anywhere in this repo**: `client.ts` passes only `{ connectionString, max: 10 }` to `pg.Pool` — **no explicit `ssl` option is set in code**. This is **not a gap requiring a code change**: `pg`'s own connection-string parser (`pg-connection-string`, a direct dependency of `pg`, read this phase at `node_modules/pg-connection-string/index.js`) already parses `?sslmode=require` (and `verify-full`, `no-verify`, etc.) directly out of `DATABASE_URL` and configures TLS accordingly — confirmed by reading that parser's source. **Operational conclusion**: a production `DATABASE_URL` pointed at a managed Postgres provider that requires TLS (AWS RDS, Render, Supabase, Heroku Postgres, etc.) should simply include `?sslmode=require` (or that provider's documented equivalent) in the connection string itself — no application code change is needed, and none was made. This is now documented explicitly for the first time (an **audit finding**, not a frozen-file change).
- **Transaction behavior**: re-confirmed unchanged — the same 5 `db.transaction()` call sites `DEPLOYMENT.md` §4 lists (profile photo primary/reorder, chat creation, gateway activation, membership activation) are still the only transactional writes in the codebase (grep-confirmed this phase: zero new `db.transaction(` call sites since B14).
- **Indexes/constraints**: B13's `PERFORMANCE_REPORT.md` already covers this in depth; `drizzle/0010_b13_performance_indexes.sql` remains the latest migration — unchanged.
- **Migration procedure for a real production cutover** (new, written out in full as this phase's own deliverable — grounded in `migrate.ts`'s real, read behavior, not invented):
  1. **Backup** — `scripts/backup-db.sh "$DATABASE_URL" ./backups` against the production database immediately before migrating. Abort on any non-zero exit.
  2. **Verify the backup** — confirm the resulting `.dump` file is non-empty and, if feasible, `pg_restore --list <file>` against it to confirm it parses (a corrupt dump should never be relied on as "verified" just because `pg_dump` exited 0).
  3. **Migrate** — `npm run db:migrate` (`src/server/db/migrate.ts`). Idempotent — safe to re-run. Applies every migration under `drizzle/` not yet recorded in `drizzle."__drizzle_migrations"`, in order, inside the migration runner's own transaction handling.
  4. **Verify schema** — `SELECT hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1;` and confirm the hash matches the newest file under `drizzle/`. For extra confidence on a real cutover, compare `information_schema.tables`/`information_schema.columns` row counts against the known-good dev/test schema.
  5. **Smoke test** — run the scenario list in B16.9 (SAFE NON-PAYMENT category) against the now-migrated instance.
  6. **Rollback decision** — if step 5 fails: for a purely additive migration (every one in this codebase's history except `0010`, which drops 4 indexes — see `DEPLOYMENT.md` §7), the safest rollback is simply redeploying the previous application build (new columns/tables the old code never reads are harmless to leave in place). For anything riskier, or if data was already written against the new schema, restore from the step-1 backup via `scripts/restore-db.sh` — this is the only fully reliable path once a migration has changed or removed something the old code depends on. **No destructive migration should ever be applied automatically** — this remains a procedural rule (`DEPLOYMENT.md` §4), not something this sandbox has (or should have) built tooling to enforce mechanically, since no CI/CD exists to host that enforcement yet (B16.13).
- **Production-readiness pre-flight (new, B16)**: `npm run check:prod-env` (see B16.6 "What B16 built") runs a read-only, pure audit of the current environment against production-safety expectations (NODE_ENV, placeholder secrets, dev-seed flag, encryption-key format) before any of the above steps — intended as step 0 of the procedure above, never a replacement for it.

---

## B16.4 Storage architecture + required production adapter plan

- **Current provider**: `LocalDiskStorageProvider` (`src/server/modules/storage/local-disk.provider.ts`) — writes under `<repo>/.storage-local/`, path-traversal-guarded (`resolveSafePath`, confirmed by reading the file: resolves every key against a fixed root, throws if the resolved path escapes it). `isConfigured()` always returns `true` (it's the filesystem, not a credentialed external service).
- **What it cannot do for a real production deployment**:
  1. **Does not survive a redeploy that replaces the disk** (most PaaS hosts and all container-orchestrated deployments use ephemeral or replaced-on-deploy filesystems unless an operator explicitly attaches persistent/network storage).
  2. **Does not work across more than one instance** — a second instance (horizontal scaling, or even a blue/green deploy with two processes briefly running) would not see files the other instance wrote, since each has its own local disk.
  3. **Has no independent backup or versioning** (re-confirmed, matches `BACKUP_DR.md`'s own honest disclosure) — `scripts/backup-db.sh` backs up Postgres only; a photo/invoice file lost from disk is lost permanently even if the database backup is intact (the `profile_photos`/`invoices` rows would then reference a file that no longer exists).
- **Required production adapter — design only, not built** (per this phase's explicit "audit/design, don't build infrastructure nobody asked for" scope, and because B16.13 correctly flags the actual provider choice as a manual decision):
  - Implement a new class satisfying the existing `StorageProvider` interface (`storage.types.ts` — `upload`/`read`/`delete`/`isConfigured`/`name`), e.g. `S3StorageProvider`, registered in `factory.ts`'s existing `if (configured === "local")` branch pattern (add an `else if (configured === "s3")` arm) — **this is a genuinely small, additive change when a real provider is chosen**, not a redesign; the interface this phase read is already shaped correctly for it.
  - Required capabilities from whichever real provider is chosen: server-side encryption at rest (native to most object stores), versioning (protects against accidental overwrite/delete — doubles as part of the backup story), and private-by-default access (the existing `local-disk.provider.ts` + `profiles.controller.ts`'s `getPhotoFileHandler` already enforce "no raw static file route, every read goes through `authenticate()`" — a real adapter must preserve that same access-control shape, e.g. via short-lived signed URLs rather than a public bucket).
  - `STORAGE_BUCKET` (already in `env.ts`'s schema, currently unused) is the natural place to configure the target bucket/container name once a real provider is chosen.

---

## B16.5 External services matrix

Every provider below uses the identical, re-confirmed pattern across OTP/push/payments: `isConfigured()` checks only that credential env vars are present (never validates them, never makes a network call); the actual `send()`/`createOrder()`/`verifyPayment()` call **always throws `ServiceUnavailableError`** in this sandbox, because **no real vendor SDK is integrated for any of them** — confirmed by reading all 5 payment provider files (`razorpay`, `cashfree`, `payu`, `phonepe`, `paytm` — each 43-48 lines, identical shape) plus the OTP/push provider files referenced by `DEPLOYMENT.md`. Each is marked **READY FOR CREDENTIAL CONFIGURATION**, explicitly never "live" — setting the env vars only flips `isConfigured()`, it does not make a real send/charge possible without also writing the real vendor SDK integration code (out of B16's scope — this is infrastructure/config audit, not new feature work).

| Service | Channel/Gateway | Credential vars | Real SDK wired in? | Status |
|---|---|---|---|---|
| OTP | Email | `EMAIL_PROVIDER`, `EMAIL_API_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| OTP | SMS | `SMS_PROVIDER`, `SMS_API_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| OTP | WhatsApp | `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| Push | — | `PUSH_PROVIDER`, `PUSH_API_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| Payment | Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | No | READY FOR CREDENTIAL CONFIGURATION |
| Payment | Cashfree Payments | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| Payment | PayU | `PAYU_MERCHANT_KEY`, `PAYU_SALT` | No | READY FOR CREDENTIAL CONFIGURATION |
| Payment | PhonePe Payment Gateway | `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| Payment | Paytm Payment Gateway | `PAYTM_MERCHANT_ID`, `PAYTM_MERCHANT_KEY` | No | READY FOR CREDENTIAL CONFIGURATION |
| Storage | (any real provider) | `STORAGE_PROVIDER`, `STORAGE_BUCKET` | No (only `local` implemented) | NOT CONFIGURED — see B16.4 |

**Dev/mock doubles remain structurally incapable of running in production** (re-confirmed by reading `dev.provider.ts` for both OTP and payments this phase): each checks `NODE_ENV !== "production"` independently at both the factory level and inside the dev class itself (defense in depth), and `tests/otp-production-guard.test.ts` / `tests/notifications-production-guard.test.ts` / `tests/payments-production-guard.test.ts` (added B14) all pass in this phase's full suite run (B16.6).

---

## B16.6 Security configuration checklist

Re-verification of `SECURITY_RELEASE_CHECKLIST.md`'s 13 items against the current, B16-session-read source — **zero drift found**; every finding in that document was re-confirmed true by independently re-reading the relevant file this phase (not re-stated on faith):

1. **Secrets not committed** — `.env`/`.env.local`/`.env.test` all git-ignored (re-read `.gitignore`). No `.git` directory exists in this sandbox (confirmed), so nothing has ever actually been committed.
2. **HTTPS** — not terminated in-app (confirmed, no cert/key handling anywhere in `src/`); `src/middleware.ts` conditionally sends HSTS only under `NODE_ENV=production` (re-read, unchanged).
3. **CORS** — `ALLOWED_ORIGINS` allowlist mechanism re-read in full this phase; behavior unchanged since B14 (unset = allow-all, set = exact-match + `Vary: Origin`).
4. **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store` all re-confirmed present on every `/api/*` response via `src/middleware.ts`.
5. **Rate limiting** — `src/server/middleware/rate-limit.ts` re-read: still in-memory, single-process, unchanged. **Carried-forward limitation, not resolved by B16** (same restraint as prior phases — no Redis introduced speculatively).
6. **Admin RBAC** — unchanged, `tests/rbac.test.ts` still passes in B16.6's full suite run.
7. **Payment webhooks** — still none; pull-based verification only (`POST /payments/:id/verify`), re-confirmed by route inventory this phase (`find src/app/api/v1 -iname route.ts | grep -i webhook` → no match).
8. **Storage security** — directory-traversal guard (`resolveSafePath`), private-by-default delivery (`getPhotoFileHandler` requires `authenticate()`), and `Cache-Control: private, max-age=300` on the photo-file route all re-confirmed by reading the actual current files this phase.
9. **Logs** — `logger.ts`'s `redact()` re-read this phase: unchanged field list (`password`, `passwordHash`, `otp`, `otpCode`, `token`, `sessionToken`, `tokenHash`, `authorization`, `apiKey`, `secret`, `cardNumber`, `cvv`), recursive, depth-capped at 6, case-insensitive.
10. **Backups** — see B16.7; re-confirmed real and working.
11. **Database access** — `DATABASE_URL` remains the only credential path anywhere in `src/` (re-grepped this phase: zero hardcoded `postgresql://` literals outside the expected files).
12. **Provider credential classification** — see B16.2's matrix above (rebuilt independently this phase, not copied).
13. **Mock providers disabled in production** — re-confirmed: all three guard test files (OTP/notifications/payments) pass in this phase's full run.

**New in B16, additive only**: `npm run check:prod-env` (B16.3/B16.6-build) gives an operator a single command to re-check items 1 (secret placeholders), 5's documentation, and a handful of config-completeness signals (encryption key format, `SEED_DEV_SUPER_ADMIN`, `NODE_ENV`) before a real deploy — it does not change the security posture of any existing endpoint.

**Overall: PASS, with the same two disclosed, non-blocking limitations `SECURITY_RELEASE_CHECKLIST.md` already names** (single-instance rate limiting; HTTPS termination and off-site backup encryption are hosting-layer requirements this sandbox cannot genuinely implement). No new P0/P1 security defect was found by this phase's audit.

---

## B16.7 Backup/DR plan

Re-confirmed against `BACKUP_DR.md` — no drift. Restated here in the B16-specified shape (RPO/RTO/procedure/failure handling), not re-tested with a new restore run this phase (the real restore-test proof already exists in `BACKUP_DR.md` §6, run against real throwaway scratch databases — re-running it would be redundant evidence, not new information, and this sandbox's instruction set treats "don't fabricate a new run" and "don't needlessly repeat a destructive-adjacent action" as the correct default; the full suite run in B16.6 below does exercise `tests/db.test.ts` and the live Postgres connection as an indirect re-confirmation that the database this policy protects is itself healthy).

- **RPO (Recovery Point Objective)**: ≤ 24 hours under the recommended daily-backup schedule, or ≤ time-since-last-deploy when a pre-deployment backup was also taken (every deploy backs up first — `scripts/deploy.sh` step 1). Documented policy choice, not a measured number.
- **RTO (Recovery Time Objective)**: grounded in `BACKUP_DR.md`'s real measurement (1s backup + 1s restore against this sandbox's ~30-row seeded scale) — **not generalizable to real production data volume**. Honest formula, unchanged: `(time to provision/access working Postgres) + (restore duration at real scale) + (app redeploy time) + 2× safety buffer`. A real deployment must re-measure against its actual data volume before quoting an RTO to any stakeholder.
- **Procedure** (unchanged from `BACKUP_DR.md` §7.3): (1) `scripts/restore-db.sh <dump> "$DATABASE_URL"` into a working Postgres instance; (2) application redeploy/restart per B16.8; (3) storage restore — **honest, unresolved gap**: local-disk-stored photos/invoices have no independent backup, so a lost disk loses them permanently even with a healthy DB restore (B16.4); (4) config restore — `.env` values restored from whatever real secrets manager the deployment uses, never from the DB backup (never in it).
- **Failure handling**: a failed `pg_dump` (non-zero exit) aborts `backup-db.sh` under `set -euo pipefail` and removes the partial `.dump` file rather than leaving a corrupt one behind (re-read in the script this phase — `rm -f "$DEST"` on the `FAILED` branch). A failed restore (`pg_restore` non-zero exit) likewise propagates as a hard failure under the same `set -euo pipefail`. Neither script silently continues past a failure.
- **Encryption / off-site copy**: still **NOT IMPLEMENTED** — no KMS, no second storage location exists in this sandbox to genuinely wire into. Documented as a real deployment requirement (pipe through `gpg --encrypt` or rely on the destination's native SSE), not fabricated as already handled.

---

## B16.8 Deployment pipeline design

**Code → install → typecheck → test → build → migration check → artifact → deploy → health check → smoke test**, with the rollback procedure B16's own instructions ask for. This expands `DEPLOYMENT.md` §6 (which `scripts/deploy.sh` already partially automates) into the exact ordered shape B16 asks for — no new automation was built beyond what already exists (`scripts/deploy.sh` covers steps 4-8 below mechanically; the rest are standard CI/build steps this sandbox has no CI system to host, consistent with B16.13).

1. **Code** — a reviewed, merged change on the deployment branch.
2. **Install** — `npm ci` (not `npm install` — reproducible, lockfile-exact).
3. **Typecheck** — `npx tsc --noEmit`. **Must be clean** — this phase confirmed it is (B16.6-build/below).
4. **Test** — `npm test` (full `vitest run` suite). **Must be 100% passing** — this phase confirmed it is (B16.6-build/below).
5. **Build** — `npm run build` (`next build`). **Must exit 0** — this phase confirmed it does.
6. **Migration check** — `npm run db:migrate` is idempotent and safe to run as a pre-flight dry-run-equivalent against a disposable copy of production schema if extra confidence is wanted; the real run happens at step 9 below, after backup.
7. **Artifact** — the built `.next/` output (+ `node_modules` per the lockfile, or whatever the hosting platform's own build step produces) — this sandbox does not package a container image (no Dockerfile exists — B16.13 names container/hosting choice as a manual decision).
8. **Deploy** — start/replace the running process with the new artifact (`npm start`, or the host's equivalent). The previous build/version stays available for rollback (B16.8's own rollback section below), per whatever artifact-retention the host provides.
9. **Database migration (real run)** — `scripts/backup-db.sh` then `npm run db:migrate` then the schema-verification query, exactly as B16.3's procedure above spells out, run against the now-live database **before** step 10's traffic cutover if the migration is additive-only, or in appropriate sequence with step 8 if a brief maintenance window is used (no maintenance-mode toggle is built — `DEPLOYMENT.md` §6 step 2 already documents this as a deliberate, disclosed non-feature for this project's pre-launch, single-instance shape).
10. **Health check** — `curl -f https://<host>/api/v1/health/ready`, expect HTTP 200 and `data.checks.database == "connected"`. A 503 or connection failure is a hard stop before step 11.
11. **Smoke test** — the SAFE NON-PAYMENT scenario list (B16.10) run against the now-deployed instance.
12. **Monitor** — watch the existing structured JSON request logs (`logger.ts`) for a sustained `statusCode >= 500` rise, `GET /api/v1/health/ready` non-200, or Postgres connection count approaching `max: 10` × instance-count.

### Rollback procedure (distinguishing the three kinds B16 asks for)

- **Application rollback**: redeploy the previous build/version. No in-app rollback mechanism is needed — "run the old code again" is sufficient, since the backend's own compatibility posture (additive migrations) means old code tolerates a newer schema.
- **Database rollback**: Drizzle-generated migrations are **not automatically reversible** (no `db:migrate:down` exists, confirmed — not in `package.json`, not in `migrate.ts`). Two honest paths: (a) for a purely additive migration (every one in this history except `0010`, which drops 4 indexes), rolling back only the application code is usually sufficient — new columns/tables the old code never reads are harmless; (b) for anything riskier, or once new data has been written against the new schema, restore from the pre-deployment backup (step 9 above) via `scripts/restore-db.sh` — the only fully reliable path.
- **Migration forward-recovery**: when rolling the database back would lose real data already written under the new schema (e.g. a migration ran, real users signed up, and only then was a defect found), the safer path is almost always a **forward-fixing migration** (a new, additive migration file that corrects the problem) rather than a backward rollback — standard practice for any system with real concurrent writers, and consistent with this codebase's "migrations are not automatically reversible" reality. This is a **documented decision framework**, not new tooling — no code was written to enforce it, matching this phase's own "design, don't build infrastructure nobody asked for" scope.
- **Configuration rollback**: revert env vars via whatever secrets-management process the real deployment uses (not implemented in this sandbox — `.env` is local-only). Must be tracked and revertible through the same secrets manager that sets them.
- **Storage rollback**: `STORAGE_PROVIDER=local` has no independent versioning (B16.4) — a storage-key-scheme change has no automated rollback until a real object-store provider with its own versioning is adopted.

---

## B16.9 Health/observability audit

Re-read `src/app/api/v1/health/route.ts`, `health/ready/route.ts`, and the shared `health.controller.ts` this phase.

- **`GET /api/v1/health`** (liveness): `select 1` against Postgres; `200 {status:"ok", database:"connected"}` or `503 {code:"INTERNAL_ERROR", ...}`. Deliberately bypasses the generic error-handling wrapper's 500 envelope (reads cleanly as a monitoring probe response — confirmed by the controller's own comment). **Unchanged since B1/B14** — `tests/health.test.ts` still asserts its exact shape and passes.
- **`GET /api/v1/health/ready`** (deep readiness, B14): three independently-reported layers — `application: "alive"` (trivially true if the process is running), `database: "connected"/"disconnected"` (same `select 1`), and `dependencies` (OTP channel configured/not, storage provider configured/not — booleans only, **never a credential value**, confirmed by reading the handler and re-confirmed by `tests/health-ready.test.ts`'s own assertion that real secret values never appear in the response body). HTTP status reflects the **database** layer only (200/503); OTP/storage gaps surface as `status: "degraded"` in the body without flapping the instance out of a load balancer's rotation over a config gap a restart wouldn't fix.
- **Logging**: one structured JSON line per request (`requestId`, `method`, `endpoint`, `statusCode`, `durationMs`, `userId?`, `error?`), redacted (B16.6 item 9), to stdout/stderr. **No log aggregation, no APM, no distributed tracing, no metrics/alerting system is wired into this codebase** — a real deployment ships these lines to whatever the host provides (CloudWatch, Loki/ELK, Datadog, etc.) and alerts on: sustained `statusCode >= 500` rate, `/health/ready` non-200, and connection-count approaching the pool ceiling. **Not built here** — correctly out of scope absent a chosen hosting platform (B16.13).
- **Gap found by this audit, not previously written down**: there is no dedicated `/metrics` (Prometheus-style) endpoint and no request-count/latency histogram exported anywhere — only the per-request log line. For a real production deployment wanting dashboarding beyond log-grepping, a metrics exporter would need to be added; **not built in B16** (new feature work, out of this phase's audit/design scope, and no metrics backend is chosen to target yet — see B16.13).

---

## B16.10 Website integration readiness

- **API shape**: fully documented in `API_REFERENCE.md` (re-read its table of contents this phase — Auth, Users, Profiles, Photos, Partner preferences, Search, Recommendations, Interactions, and more, each endpoint's method/path/auth-requirement/rate-limit noted). Consistent, versioned under `/api/v1`.
- **CORS**: `ALLOWED_ORIGINS` must be set to the real website's origin(s) before launch (currently unset = allow-all in this sandbox, which is fine pre-launch but not a final production policy — B16.13 flags "what is the real frontend domain" as a manual decision this document cannot guess).
- **Auth model**: Bearer session tokens (confirmed via `API_REFERENCE.md` §1 and `mobile-integration.test.ts`'s own header-shape test) — works identically for a browser-based website client making `fetch()` calls with an `Authorization` header, no server-side cookie/session-store dependency to stand up separately.
- **Error envelope**: consistent `{ code, message, details? }` shape via `withErrorHandling` (confirmed — every route uses the same wrapper), so a website client can build one shared error-handling layer rather than per-endpoint parsing.
- **What's missing for a real website launch (not a backend defect — explicitly a configuration/manual-decision gap)**: the real production domain/CORS origin (B16.13), and confirmation that the website's own hosting (if separate from this API) can reach `API_URL` over HTTPS once hosting is chosen.

## B16.11 Android integration readiness

- **B11 already built dedicated mobile-shaped coverage**: `tests/mobile-integration.test.ts`, re-read this phase — proves the full register → profile → search → interest → match → chat → membership → payment → invoice path works with exactly the headers a bare-bones Android HTTP client sends (`Authorization: Bearer <token>` + `Content-Type: application/json`, no cookies, no browser-specific headers), confirmed still passing in this phase's full suite run.
- **Stateless auth**: no server-side session store beyond the `device_sessions` table keyed by an opaque bearer token — naturally fits a mobile client's own secure-storage-for-token pattern; no CSRF token or cookie-based mechanism to port.
- **Pagination contract**: consistent `page`/`pageSize`/`total`/`totalPages` shape across list endpoints with a documented DEFAULT/MAX convention (confirmed by `mobile-integration.test.ts`'s own §2.12 coverage, re-read this phase) — a mobile client can build one shared paginator against every list endpoint.
- **Payment resilience for mobile's "app killed mid-checkout" shape**: already covered (`mobile-integration.test.ts` §2.10 — poll-after-reopen and duplicate-callback-retry scenarios), consistent with the pull-based (not webhook-based) verification model (B16.5/B16.6 item 7) that a mobile client polling `POST /payments/:id/verify` naturally fits.
- **What's missing for a real Android launch (configuration/manual-decision gaps, not backend defects)**: real push credentials (B16.5 — `PUSH_PROVIDER`/`PUSH_API_KEY`, FCM being the de facto standard for Android but genuinely a choice for the project owner, not assumed here), and the real app's package/signing identity is unrelated to this backend (nothing in this codebase references an Android package name or API level).

---

## B16.12 Production payment gate checklist

Thirteen items — every real-money payment path must satisfy ALL of these before being switched on for real traffic. Each marked against this sandbox's actual current state (re-confirmed by reading the relevant file this phase, not assumed):

| # | Item | Current state |
|---|---|---|
| 1 | Real vendor SDK integrated for at least one gateway (not just env vars present) | ❌ NOT DONE — all 5 providers throw honestly (B16.5); writing a real SDK integration is new feature work, out of B16's audit/design scope |
| 2 | `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` set to a real, unique 64-hex-char value (never the dev/test value reused) | ❌ NOT CONFIGURED in this sandbox — `check:prod-env` (B16, new) verifies the *format* when set, never generates or stores a real one |
| 3 | Real gateway credentials obtained from the vendor (merchant account, API keys) and stored only via the encrypted path (`PATCH /admin/payment-gateways/:id`) | ❌ NOT OBTAINED — manual decision (B16.13) |
| 4 | `isConfigured()` returns true for the intended gateway under real production env | Mechanically true once real credential env vars are set — re-confirmed by reading each provider's `isConfigured()` (presence-only check) |
| 5 | Amount/currency cross-check between stored order and gateway's verify response | ✅ ALREADY BUILT — `payments.service.ts`'s B10 cross-check, re-confirmed present and covered by `tests/security-regression.test.ts` (unchanged, passing) |
| 6 | No client-claimed success is ever trusted | ✅ ALREADY BUILT — every provider's contract (`types.ts`) and `payments.service.ts`'s own top-of-file comment enforce server-side verify only; re-confirmed this phase |
| 7 | Duplicate-payment/double-activation protection | ✅ ALREADY BUILT — `activateMembershipFromPayment`'s transaction (B16.3) cancels any other ACTIVE membership before activating the new one; re-confirmed present |
| 8 | Mock/dev payment provider structurally cannot run under `NODE_ENV=production` | ✅ ALREADY BUILT AND TESTED — `tests/payments-production-guard.test.ts` (B14, 6 tests), re-confirmed passing in B16's full suite run |
| 9 | GST/tax rate confirmed as the real, legally-correct rate (not the `GST_RATE_PERCENT=18` placeholder) | ❌ NOT CONFIRMED — explicitly flagged as unresearched tax law in `env.ts`'s own comment, re-confirmed by this phase, not resolved |
| 10 | A real, tested refund/chargeback-handling path exists | ❌ NOT BUILT — no refund endpoint exists anywhere in `API_REFERENCE.md`'s Payments section (confirmed by reading it); out of scope to build in an audit phase |
| 11 | Webhook OR a documented, sufficient pull-based verification strategy for payment completion | ✅ DOCUMENTED AS-IS — pull-based only (`POST /payments/:id/verify`), by design, re-confirmed accurate (B16.6 item 7) — acceptable as a strategy, but the project owner must knowingly accept "no webhook" as the launch posture, not discover it after going live |
| 12 | Real-money test transaction performed successfully in the chosen gateway's sandbox/UAT environment before going live | ❌ NEVER PERFORMED — this sandbox has no real vendor account to test against (ABSOLUTE RULE: do not send real OTPs, do not charge real money) |
| 13 | Security review of the real SDK integration code once written (secret handling, signature/HMAC verification of any webhook or redirect callback the real vendor requires) | ❌ N/A — no real SDK integration exists yet to review |

**Gate verdict: NOT MET.** Items 1, 2, 3, 9, 10, 12, 13 are blocked on genuine external/manual decisions and real vendor integration work this phase correctly did not fabricate. This is the expected, honest state for a pre-launch sandbox with no real hosting or vendor relationship — not a backend defect.

---

## B16.13 Production smoke-test plan

Twenty items, split into SAFE NON-PAYMENT (runnable against a real deployed instance with zero financial risk — items 1-14, overlapping with and extending `tests/smoke.test.ts`'s existing 17-scenario/1-test suite, re-confirmed passing in B16.6's full run) and REAL PAYMENT (items 15-20, which must **never** be run against this sandbox — no real vendor credentials exist — and must only be run by the project owner, deliberately, against a real gateway's own sandbox/UAT environment first, per B16.12 item 12).

### SAFE NON-PAYMENT (no real money, no real OTP send — run freely against a real deployed instance)

1. `GET /api/v1/health` returns 200, `database: "connected"`.
2. `GET /api/v1/health/ready` returns 200, all three check layers report correctly.
3. `POST /api/v1/auth/register` → `verify-signup-otp` (dev-mode OTP) → `set-password` completes a full signup.
4. `POST /api/v1/auth/login` with the just-created account succeeds and returns a session token.
5. `GET /api/v1/users/me` with that token returns the correct user.
6. `POST /api/v1/profiles/me` + `PATCH /api/v1/profiles/me` create and update a profile.
7. `POST /api/v1/profiles/me/photos` uploads a photo via the configured storage provider.
8. `GET /api/v1/search/profiles` (anonymous) returns results without erroring.
9. `GET /api/v1/profiles/me/recommendations` (authenticated) returns results without erroring.
10. `POST /api/v1/interactions/interests` sends an interest (requires an active membership per business rules — use the dev/mock membership path, never a real charge).
11. Mutual interest creates a match and a chat; `GET` the chat's messages as a participant succeeds, as a non-participant returns 403/404.
12. `GET /api/v1/memberships/me` and `GET /api/v1/membership-plans` return correctly without any payment action.
13. `POST /api/v1/admin/login` with a real (non-dev-seeded, since `SEED_DEV_SUPER_ADMIN` must be false in production) admin account succeeds; `GET /api/v1/admin/ping` confirms RBAC.
14. `GET /api/v1/invoices/me` returns correctly for a user with zero invoices (empty list, not an error).

### REAL PAYMENT (financial risk — project owner only, real vendor sandbox/UAT first, never this sandbox)

15. A real gateway's checkout flow (`POST /api/v1/memberships/checkout`) creates a real order against the vendor's sandbox environment.
16. The vendor's real verify/webhook (if the chosen gateway offers one the project later decides to build) or the pull-based `POST /api/v1/payments/:id/verify` correctly reflects a real sandbox-environment SUCCESS.
17. A real sandbox-environment FAILED payment correctly does **not** activate a membership (mirrors `tests/payments.test.ts`'s existing `[pay-verify-failed-no-activation]` coverage, now against a real vendor response shape).
18. A real sandbox-environment duplicate/retried verify call does not double-activate or double-charge (mirrors existing duplicate-protection tests against a real vendor response shape).
19. A real invoice is generated and downloadable for the successful sandbox transaction, with the real (confirmed, non-placeholder) GST rate applied.
20. The real transaction appears correctly in the admin dashboard (`GET /api/v1/admin/...` — payments/invoices listing) with the correct gateway name and amount.

**Items 15-20 require**: a real merchant account with the chosen gateway, real (sandbox-tier) credentials configured via the encrypted credential path, and the real vendor SDK integration (B16.12 item 1) actually written — none of which exist in this sandbox. **This phase performed zero real payment transactions, exactly per the ABSOLUTE RULES governing this work.**

---

## B16.14 Known limitations (carried forward, re-verified; nothing silently marked resolved)

All 10 limitations from the context already established for this phase, individually re-verified by this phase's own reading of the relevant current file (not restated on faith):

1. **Single-instance in-memory rate limiting, no Redis** — re-confirmed, `rate-limit.ts` unchanged.
2. **Local-disk storage only, no real cloud provider, no independent backup/versioning** — re-confirmed (B16.4).
3. **No real hosting target selected** — re-confirmed; B16.13 names this as a manual decision.
4. **No CI/CD pipeline connected** — re-confirmed, no YAML/workflow files exist anywhere in the repo.
5. **Backup encryption/off-site backup not implemented** (local unencrypted `pg_dump` only) — re-confirmed (B16.7).
6. **RTO measured only at sandbox scale** — re-confirmed, same honest caveat restated (B16.7).
7. **No payment-gateway webhook endpoint** (pull-based verification by design) — re-confirmed (B16.6 item 7, B16.12 item 11).
8. **Bounded per-item enrichment cost in search/recommendations** (deliberately deferred, B13 scope) — unchanged, not re-audited in depth this phase (outside B16's infrastructure focus; no new finding to report).
9. **Real payment-gateway transaction testing never performed** — re-confirmed (B16.12 item 12); still true after this phase.
10. **No real production secrets/KMS/object-storage environment exists in this sandbox** — re-confirmed throughout this document.

**No limitation above was resolved by B16** — this phase is audit/design only, consistent with its own scope.

---

## B16.15 Prerequisites for a real production launch

Everything that must be true before this backend can safely serve real users and real money, gathered from the sections above into one list:

- [ ] A real hosting target is chosen and provisioned (B16.13).
- [ ] A real, managed PostgreSQL 16+ instance exists, with its connection string (including `?sslmode=require` or the provider's TLS equivalent — B16.3) set as `DATABASE_URL`.
- [ ] `AUTH_SECRET` is a real, long, randomly generated value (never the `.env.example` placeholder) — verify with `npm run check:prod-env`.
- [ ] `SEED_DEV_SUPER_ADMIN` is false/unset, and the real first Super Admin account is created through a real, intentional process (not documented/built in B16 — a manual admin-provisioning step).
- [ ] `ALLOWED_ORIGINS` is set to the real website/Android-backing origins.
- [ ] At least one real OTP delivery channel is integrated with a real vendor SDK and its credentials configured.
- [ ] A real storage provider adapter is implemented (B16.4) and `STORAGE_PROVIDER`/`STORAGE_BUCKET` point at it.
- [ ] `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` is a real, unique 64-hex-char value.
- [ ] At least one payment gateway has a real vendor SDK integration written, reviewed, and its B16.12 gate fully met.
- [ ] The real GST/tax rate is confirmed and set (`GST_RATE_PERCENT`), replacing the 18% placeholder.
- [ ] A real backup schedule (cron/scheduled job) invokes `scripts/backup-db.sh` daily, with its output encrypted and copied off-box (B16.7).
- [ ] A CI/CD pipeline (or at minimum a documented manual runbook) executes the B16.8 pipeline steps in order before every deploy.
- [ ] Log aggregation and alerting are wired to the existing structured JSON request logs (B16.9).
- [ ] The B16.10/B16.11 website/Android readiness items are each individually confirmed against the real, chosen client deployments.

---

## B16.16 MANUAL DECISION REQUIRED

Every genuinely external decision this document does not guess or default — each requires the project owner's own choice:

1. **Hosting provider** — no cloud/hosting platform has ever been named in this project (B14, B15, and this phase all independently confirm this). This document deliberately stays provider-agnostic.
2. **Domain and DNS** — no production domain exists; `APP_URL`/`API_URL` are placeholders (`http://localhost:3000`).
3. **Real payment-gateway credentials** — which of the 5 scaffolded gateways (or another not yet scaffolded) to actually contract with, and their real merchant credentials.
4. **Real SMS/WhatsApp/email vendor** — which provider to integrate a real SDK against for OTP delivery (Twilio, MSG91, AWS SES, etc. are all equally unchosen here).
5. **Real push-notification vendor** — e.g. FCM for Android, APNs if iOS is ever added; not assumed.
6. **Cloud storage provider** — S3, GCS, Azure Blob, Cloudinary, or another — for the real `StorageProvider` adapter (B16.4).
7. **KMS / secrets manager** — for encrypting `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` itself, off-box backup encryption, and general secret storage in a real deployment (AWS KMS/Secrets Manager, GCP KMS, HashiCorp Vault, or a PaaS's own built-in secret store).
8. **CI/CD platform** — GitHub Actions, GitLab CI, CircleCI, or another — to host the B16.8 pipeline; none is chosen, and none exists in this repo today.
9. **The real applicable GST/tax rate** — confirmed with a real tax advisor, not assumed from the current 18% placeholder.
10. **Maintenance-mode / zero-downtime deploy strategy**, if and when real user volume makes the current "brief elevated latency during migration" trade-off (B16.8 step 9) no longer acceptable.
11. **Refund/chargeback policy and implementation** — no refund path exists in this codebase at all (B16.12 item 10); the business policy itself (not just the code) is undecided.
12. **First real Super Admin provisioning process** — how the very first real admin account is created safely in a production environment where `SEED_DEV_SUPER_ADMIN` must stay false.

None of the above was guessed, defaulted, or silently assumed anywhere in this document or in any code this phase wrote.
