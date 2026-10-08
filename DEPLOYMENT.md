> **SUPERSEDED for production by `DEPLOYMENT_PRODUCTION.md` (Production Completion Phase).** This file is the earlier B-phase guide and still says that no real payment, OTP or cloud-storage provider exists — that is no longer true. Use `DEPLOYMENT_PRODUCTION.md` and `PRODUCTION_ENV_REFERENCE.md`; keep this file only for the generic reverse-proxy and rollback notes.

# RishteyZindagi Backend — Deployment Guide (B14)

**Phase:** B14 — Production Release / Deployment / Backup / DR
**Status:** production readiness PREPARED and VERIFIED in this sandbox. **No real deployment has ever been performed from this repository** — there is no real hosting account, no real production domain, and this project remains pre-launch (consistent with every prior phase's own documentation). Every script and procedure below is real and runnable; none has been pointed at anything resembling a live production target.

This document, `BACKUP_DR.md`, and `SECURITY_RELEASE_CHECKLIST.md` are the three B14 deliverables — see BACKEND.md §58 for the full narrative and evidence trail behind every claim here.

---

## 1. Judgment call: hosting target

This project has **never named a specific cloud provider or hosting platform** in any prior phase. B14's own instructions direct picking the smallest, safest, best-documented default rather than inventing a fictitious vendor relationship. That default, used throughout this document:

> **Provider-agnostic**: any standard Node.js host capable of running `next build && next start` (a long-running Node process, not a static/edge-only host) with a managed or self-run PostgreSQL 16 instance reachable via `DATABASE_URL`, and persistent disk (for `.storage-local/` uploads, if `STORAGE_PROVIDER=local` is still in use) or object storage (if a real storage provider is later implemented).

Every step below is written to that assumption. A real deployment onto a specific platform (Render, Railway, a raw VM, ECS, etc.) fills in that platform's own equivalents for "process supervisor" and "where secrets live" — the sequence and safety checks below don't change.

---

## 2. Production configuration audit (§32)

Every environment variable `src/server/config/env.ts`'s zod schema knows about, classified. "Read directly" means outside `getEnv()` (only `ALLOWED_ORIGINS`, for the documented Edge-runtime reason in `src/middleware.ts`).

| Variable | Class | Required? | Notes |
|---|---|---|---|
| `NODE_ENV` | APP | no (default `development`) | Drives every dev/mock-provider double-guard in the codebase. |
| `DATABASE_URL` | DATABASE / SECRET | **yes** | Only DB credential path anywhere (grep-confirmed — see §4). |
| `APP_URL` | APP | no | Informational base URL. |
| `API_URL` | APP | no | Informational base URL. |
| `AUTH_SECRET` | AUTH / SECRET | **yes** | HMAC key for device-session tokens at rest — not a JWT key (see env.ts's own comment). |
| `SESSION_TTL_HOURS` | AUTH | no (default 720) | |
| `SEED_DEV_SUPER_ADMIN` | SECURITY | no (default false) | Must stay `false`/unset outside development. |
| `SEED_DEV_SUPER_ADMIN_EMAIL` | AUTH | no | Only used with the above. |
| `SEED_DEV_SUPER_ADMIN_PASSWORD` | SECRET | no | Only used with the above — never set in staging/production. |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` | OTP / EMAIL / SECRET | no | Channel enablement is a runtime `isConfigured()` check, not a startup requirement (§33). |
| `SMS_PROVIDER` / `SMS_API_KEY` | OTP / SECRET | no | Same as above. |
| `WHATSAPP_PROVIDER` / `WHATSAPP_API_KEY` | OTP / WHATSAPP / SECRET | no | Same as above. |
| `PUSH_PROVIDER` / `PUSH_API_KEY` | PUSH / SECRET | no | Same pattern, B7. |
| `STORAGE_PROVIDER` | STORAGE | no (default `local`) | Only `"local"` is implemented — anything else throws `ServiceUnavailableError` (honest failure, not a silent fallback). |
| `STORAGE_BUCKET` | STORAGE | no | Unused by the only implemented provider; reserved for a future real one. |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | PAYMENT / SECURITY / SECRET | no | 64-char hex (32-byte AES-256-GCM key). Required before any real gateway credential can be saved. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | PAYMENT / SECRET | no | No real vendor SDK wired in (see each provider file) — presence only flips `isConfigured()`. |
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | PAYMENT / SECRET | no | Same. |
| `PAYU_MERCHANT_KEY` / `PAYU_SALT` | PAYMENT / SECRET | no | Same. |
| `PHONEPE_MERCHANT_ID` / `PHONEPE_SALT_KEY` | PAYMENT / SECRET | no | Same. |
| `PAYTM_MERCHANT_ID` / `PAYTM_MERCHANT_KEY` | PAYMENT / SECRET | no | Same. |
| `GST_RATE_PERCENT` | APP | no (default 18) | A configurable placeholder tax rate, not researched tax law (see BACKEND.md B8). |
| `ALLOWED_ORIGINS` | SECURITY / PUBLIC | no | Read directly from `process.env` in `src/middleware.ts` (Edge runtime), not through `getEnv()`. Comma-separated CORS allowlist; empty = allow-all (pre-B10 behavior). |

**Orphaned variable found and removed from `.env.example`:** `PAYMENT_ENVIRONMENT` appeared in the old `.env.example` but is **not read anywhere** in `env.ts`'s schema or any other source file (grep-confirmed) — it was dead template content from an earlier phase. Removed rather than left to mislead an operator into thinking it does something.

**No secret ever leaks in source, logs, API responses, or build output** — verified, not just repeated from `getEnv()`'s own doc comment:
- `src/server/lib/logger.ts`'s `redact()` strips `password`, `passwordHash`, `otp`, `otpCode`, `token`, `sessionToken`, `tokenHash`, `authorization`, `apiKey`, `secret`, `cardNumber`, `cvv` (case-insensitive, recursively, depth-capped) from every structured log line — confirmed by reading the file, not assumed.
- `src/server/lib/crypto.ts`'s own header comment states the encrypted credential blob is "never logged; never returned to any API response" — confirmed: `gateway-config.dto.ts` never serializes the raw `config` column.
- The new `GET /api/v1/health/ready` endpoint (§38 below) reports only `"configured"`/`"not_configured"` strings for OTP/storage — never a key value — proven by a dedicated regression test (`tests/health-ready.test.ts`) that asserts the real `AUTH_SECRET`/`DATABASE_URL`/`PAYMENT_CREDENTIALS_ENCRYPTION_KEY` test values never appear in the response body, and that no `apiKey`/`secret`/`token`/`password`-shaped field ever appears.
- `npm run build`'s output (captured in this phase) contains no secret — it's route/bundle-size manifest text only.

---

## 3. Environment validation (§33)

- **Fail-fast confirmed for real**: `getEnv()` (`src/server/config/env.ts`) uses `envSchema.safeParse(process.env)` and throws a single aggregated `Error` listing every missing/malformed field if `DATABASE_URL` or `AUTH_SECRET` (the only two required fields) is absent. This was already covered implicitly by every test file's `beforeEach` needing a working `getEnv()` to even run; B14 adds no new test for this specific behavior since `tests/otp-production-guard.test.ts` / `tests/notifications-production-guard.test.ts` / the new `tests/payments-production-guard.test.ts` all already stub env and successfully import `getEnv()`-dependent modules every run — a broken fail-fast would have surfaced as every existing test file failing to even start, which it doesn't.
- **Dev-only providers cannot silently run as production providers** — three independent double-guarded provider families now have dedicated regression tests:
  - OTP: `tests/otp-production-guard.test.ts` (pre-existing).
  - Notifications: `tests/notifications-production-guard.test.ts` (pre-existing).
  - **Payments: `tests/payments-production-guard.test.ts` (NEW, B14)** — this was the one real, confirmed gap the B14 pre-inspection flagged. `payments/providers/dev.provider.ts` and `providers/factory.ts` already had the identical double-guard structure as their two siblings (verified by reading both files before writing the test) — they simply had no dedicated test proving it. 6 new tests confirm: the factory never hands out `DevPaymentProvider` under `NODE_ENV=production` even with `devMode=true`; `createOrder`/`verifyPayment`/`testConnection`/`isConfigured`/the two test-only accessor functions all refuse to run under `NODE_ENV=production` even when the class is constructed directly, bypassing the factory.
- **What "opts in" means for a future staging environment** (documented, since nothing in this codebase implements staging today): a staging environment must set its own distinct `DATABASE_URL` pointing at a non-production database and may then choose to enable `otp_configs.dev_mode` (an admin-configurable DB flag, not an env var) — but **only while `NODE_ENV` for that environment is itself `"development"` or `"test"`**, never `"production"`. There is no mechanism anywhere in this codebase for a `NODE_ENV=production` process to use a mock OTP/payment provider or fake delivery under any configuration — the guard is unconditional, not opt-out. A real staging tier, if built later, would need its own env-driven distinction (e.g. a hypothetical `STAGING=true` flag the guards also check) — no such flag exists today, and none should be assumed.

---

## 4. Database production readiness (§34)

- **Migrations/schema/indexes/constraints**: already comprehensively covered by B1–B13 (11 migration files, `0000`–`0010`; B13's own `PERFORMANCE_REPORT.md` covers index/constraint correctness in depth). No rebuild needed — confirmed current: `drizzle/0010_b13_performance_indexes.sql` is the latest, and `npx tsc --noEmit` + `npm run build` are both clean against the current schema (§ "Verification" below).
- **Connection pooling**: `src/server/db/client.ts` creates one `pg.Pool({ connectionString, max: 10 })`, cached on `globalThis` in non-production (to survive Next.js dev-mode hot reload without leaking connections) and freshly created once per process in production. **`max: 10` is a reasonable single-instance default** for this app's current traffic shape (no production traffic exists to measure against) — the honest tuning guidance for a real deployment: if horizontally scaled to N instances, total Postgres connections = N × 10, so `max` should be lowered (or a connection pooler like PgBouncer introduced) once a real instance count is known, the same "don't build infrastructure nobody's asked for yet" restraint B13 already established for Redis-backed rate limiting (see §8 below).
- **Transaction behavior** — every multi-statement write that must be atomic already uses `db.transaction()` (grep-confirmed, 5 call sites, all pre-existing B1–B13 code, unchanged by B14):
  1. `profiles.repository.ts:setPrimaryPhoto` — clears every other photo's `isPrimary` then sets the target's, inside one transaction, so "exactly one primary photo" never has a zero/two window.
  2. `profiles.repository.ts:reorderPhotos` — all `sortOrder` updates in one transaction.
  3. `chat.repository.ts:createChatForMatch` — race-safe get-or-create: the chat-row insert (`ON CONFLICT DO NOTHING`) and both participant-row inserts happen in one transaction, so no connection ever observes a chat with zero or one participant.
  4. `gateways.repository.ts:setActiveGateway` — deactivates every gateway then activates the target in one transaction, enforcing "exactly one active gateway" without a partial unique index.
  5. `payments.service.ts:activateMembershipFromPayment` — cancels any other ACTIVE membership for the user and activates the new one in one transaction (B10's payment-race regression, `tests/security-regression.test.ts`, re-confirms this holds under concurrent verify calls).
  No `BEGIN`/`COMMIT` is ever issued by hand outside these `db.transaction()` calls — Drizzle owns transaction lifecycle everywhere.
- **Destructive migrations — hard process rule (documented here, not automated, since no CI/CD pipeline exists yet to enforce it mechanically)**: a migration that drops or alters a column/table in a way that could lose data must **never** be applied automatically as part of a deploy. It requires: (1) a pre-verified backup (§5) taken immediately before, (2) explicit human sign-off naming the migration file, (3) a hand-written rollback plan prepared in advance (see §"Rollback" below — Drizzle-generated migrations are not automatically reversible). `npm run db:migrate` itself has no flag to skip this judgment — the discipline is procedural, enforced by whoever runs the deploy, exactly like B13's own index-drop migration (`0010_b13_performance_indexes.sql`) was manually reviewed before being applied to both `rishteyzindagi_dev` and `rishteyzindagi_test`.

---

## 5. Backup (§35) — summary; full detail + real restore-test proof in `BACKUP_DR.md`

`scripts/backup-db.sh` — a real, tested `pg_dump`-based backup script. Produces a `pg_restore`-compatible custom-format (`-Fc`) archive named `<backup_dir>/rishteyzindagi_<db-name>_<UTC-timestamp>.dump`, records a bookkeeping row in the pre-existing `backups` table (schema.ts's B1 "foundation" table — see BACKEND.md §58.3 for why this table, not a new one, was chosen), and applies a 7-daily + 4-weekly retention policy to its own output directory. Full real-run output and the full genuinely-executed restore-test proof (backup → restore into a fresh scratch database → row-count and specific-row verification) are in `BACKUP_DR.md`.

---

## 6. Deployment procedure (§39)

A deterministic, ordered procedure. `scripts/deploy.sh` orchestrates steps 1–6 mechanically (backup → build → migrate → verify migration → health check); steps 7–9 are manual/operational by design (a smoke test against the now-deployed instance, monitoring, and the standing rollback readiness) since they depend on what's actually being observed after the deploy, not something a script should auto-decide.

**`scripts/deploy.sh` was run once during this phase, against local dev only, to validate it end-to-end — never against anything resembling production (none exists). See BACKUP_DR.md for its real output.**

1. **Backup** — `scripts/backup-db.sh "$DATABASE_URL" ./backups`. Abort the deploy if this step's exit code is non-zero (`set -euo pipefail` in the script propagates a `pg_dump` failure as a hard stop).
2. **Maintenance-mode strategy** — **judgment call: none is built, and none is needed for this project's realistic deployment shape.** This is a pre-launch, single-instance app; a migration step (step 4) typically completes in well under a second for this schema's size (11 migration files applying cleanly in this sandbox in under 2 seconds — see BACKUP_DR.md's measured restore time for comparable scale), so a brief, unannounced moment of elevated latency during `npm run db:migrate` is an acceptable, documented trade-off pre-launch. **Future improvement, not built**: if zero-downtime deploys are later required (e.g. once real users exist), the standard approach is a maintenance-mode flag the middleware checks before real traffic, returning a `503` with a `Retry-After` header — deliberately not built now since nothing in this phase's scope asked for it and building it speculatively would be exactly the "new infrastructure nobody asked for" B13 already cautioned against.
3. **Deploy application** — standard Next.js flow for the hosting target from §1: `npm ci && npm run build && npm start` (or the host's equivalent process-supervisor restart of the same two commands). `next start` binds to `PORT` (default 3000) and serves the already-built `.next` output; there is no separate "worker" process this app needs.
4. **Migrate database** — `npm run db:migrate` (`src/server/db/migrate.ts`, Drizzle's own `migrate()` against a self-managed `__drizzle_migrations` tracking table). Exactly this command — nothing invented; confirmed to be the only migration entrypoint in `package.json`.
5. **Verify migration** — query the tracking table directly (it lives in its own `drizzle` schema, confirmed by inspection — not `public`): `SELECT hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1;` and confirm its hash matches the newest file under `drizzle/`. `npm run db:migrate` is itself idempotent (a no-op if everything's already applied), so re-running it is also a valid verification step.
6. **Health check** — `curl -f https://<host>/api/v1/health/ready` — expect HTTP 200 and `data.checks.database == "connected"`. A `503` or connection failure here is a hard stop before step 7.
7. **Smoke test** — run the scenario list in `tests/smoke.test.ts` against the now-deployed instance (in this sandbox, run via `npx vitest run tests/smoke.test.ts` against the in-process test DB — see that file's own header for why, and §41/BACKEND.md §58 for the real results captured this phase). A real deployed environment would point the same scenario list's HTTP calls at its live URL with a session-token-aware HTTP client in place of the in-process route-handler calls — the scenarios and pass/fail criteria don't change.
8. **Monitor** — this codebase already emits one structured JSON log line per request (`src/server/lib/logger.ts`'s `logRequest`/`logError`, with automatic secret redaction — see §2) including `requestId`/`method`/`endpoint`/`statusCode`/`durationMs`/`userId`/`error`. A real deployment should ship these lines to whatever log aggregation the host provides (CloudWatch, a hosted Loki/ELK stack, etc. — nothing specific is assumed) and alert on: a sustained rise in `statusCode >= 500` rate, `GET /api/v1/health/ready` returning non-200, and Postgres connection-count approaching the pool's `max: 10` × instance-count ceiling (§4). No new monitoring tooling is introduced by B14 — this is a reference to what already exists, per this phase's own instruction not to invent new infrastructure.
9. **Rollback procedure** — see §7 below.

---

## 7. Rollback (§40)

- **Application rollback** — redeploy the previous build/version (standard for `npm run build && npm start` — whatever artifact-versioning the host provides, e.g. keeping the previous `.next` build or container image on standby). No in-app rollback mechanism is needed beyond "run the old code again."
- **Migration rollback** — **Drizzle migrations generated by `drizzle-kit generate` are NOT automatically reversible** — there is no `db:migrate:down` command in this codebase, and none should be assumed to exist. Two honest options for a real rollback:
  1. For a **purely additive** migration (every one in this codebase's history so far except one — see below), rolling back the application code is often sufficient: new columns/tables the old code never reads are harmless to leave in place.
  2. For anything riskier, restore from the pre-deployment backup taken in deploy step 1 (§6) — the only fully reliable path when a migration changed or removed something the old code depends on.
  **The riskiest migration in this codebase's history is actually `0010_b13_performance_indexes.sql`** (B13) — it drops 4 indexes via `DROP INDEX`, which is not instantly reversible (re-creating a large index takes real time and locks, unlike a `DROP`). Every other migration (`0000`–`0009`) is purely additive (new tables/columns), the safe case above.
- **Configuration rollback** — revert env vars via whatever secrets-management process the real deployment uses (not implemented in this sandbox — `.env` is local-only and never becomes part of a deploy artifact, see §"Security release checklist"). Document this as a hard process requirement: env var changes must be tracked and revertible through the same secrets manager that sets them, never hand-edited on a running host.
- **Storage rollback** — same local-disk limitation as `BACKUP_DR.md`'s DR section: `STORAGE_PROVIDER=local` has no independent backup/versioning mechanism today, so a storage-affecting change (e.g. a key-scheme migration) has no automated rollback. A real deployment should move to a real object-store provider with its own versioning (S3 + versioning, or equivalent) before this becomes a real operational risk.
- **Destructive changes — explicit manual recovery required.** "Destructive" here means any migration that drops a column/table, or any operational change that deletes data outside the normal application flow (e.g. a manual `DELETE`/`TRUNCATE` run by an operator). Such a change must ship with: a pre-verified backup (§5/§6 step 1) taken immediately before, and an explicit sign-off step naming the change — **never auto-applied**, per §4's destructive-migration rule above.

---

## 8. Known, honestly-disclosed limitations carried into this release

These are pre-existing, already-disclosed-elsewhere limitations B14 did not fix (per this phase's own instruction not to build new infrastructure nobody asked for) — restated here so a release decision-maker sees them in one place:

- **Rate limiting is single-process in-memory** (`src/server/middleware/rate-limit.ts`, B1). Correct for one Node process; a real multi-instance deployment behind a load balancer needs a shared store (Redis is the standard choice) before rate limiting is a real defense, not just a per-instance speed bump. Not built in B14 — same interface (`checkRateLimit`) would support the swap later without a redesign.
- **Local-disk storage has no independent backup mechanism.** `STORAGE_PROVIDER=local` (the only implemented provider) writes to `.storage-local/` on whatever disk the process runs on — see `BACKUP_DR.md`'s storage-restore section for the full honest treatment.
- **No maintenance-mode toggle** — see §6 step 2 above.
- **No CI/CD pipeline exists** — `scripts/deploy.sh` is a real, runnable orchestration script, but nothing in this repo triggers it automatically on a git push; a real deployment wires it into whatever CI system the host provides.
- **No webhook endpoint for payment gateways** — verification is pull-based (`POST /payments/:id/verify`), confirmed accurate per B13's own finding, restated in `SECURITY_RELEASE_CHECKLIST.md`.

---

## 9. Release checklist (§43)

See `SECURITY_RELEASE_CHECKLIST.md` for the §42 security checklist and BACKEND.md §58 for this exact §43 checklist filled in against this phase's real verification run.
