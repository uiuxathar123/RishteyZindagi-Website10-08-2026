# QA Baseline

What has actually been tested, how, and what has not. The only runs during this audit were the targeted checks for the D-1 fix (§1a); every other result below comes from an existing artifact, and its date is given.

The requirement-by-requirement matrix from phase B12 is `QA_TRACEABILITY_MATRIX.md`; this document is the current baseline on top of it.

## 1. Last full automated run

Source: `vitest-full.log` in the project root (UTF-16 text, 7.7 MB, ignored by Git). Written 2026-10-11 19:37 IST.

| Measure | Result |
|---|---|
| Test files | 91 total: **90 passed, 1 skipped** |
| Tests | 814 total: **794 passed, 20 skipped, 0 failed** |
| Duration | 1,669.6 s (about 28 minutes), sequential (`fileParallelism: false`, one worker) |
| Database | Real PostgreSQL test database from `.env.test` (not opened in this audit) |
| Coverage of the tree | All 91 `tests/*.test.ts` files in the current tree appear in the log |

Skipped tests and why (from the test sources):

* `tests/pcp-backup.test.ts`: four `describe.skipIf(!hasTools)` blocks (encrypted backup, restore verification, off-box destinations, S3 off-box via moto). They skip when `pg_dump`/`gpg`-style tools or the Python `moto` mock aren't installed.
* `tests/pcp-storage.test.ts`: `describe.skipIf(!hasMoto)` for the S3 provider verified against moto.

So **backup/restore and real S3 SigV4 behaviour were not exercised in that run.**

### 1a. Targeted runs during this audit (2026-10-17)

| Command | Result | Scope |
|---|---|---|
| `npx vitest run tests/b19-contact-change.test.ts` | 4 passed, 0 failed (19.7 s) | D-1 fix only; run against the test database from `.env.test` |
| `npx tsc --noEmit` | exit 0 | Whole project type-check |

Both were run after the D-1 change and before commit `4262de9`. Nothing else was re-run.

### The full run does not cover the current code

Twelve source or test files were modified after the log was written. Nine changed on 2026-10-12 (file times):

| Time | File |
|---|---|
| 00:38 | `tests/b19-chat-stream.test.ts` |
| 02:36 | `src/app/admin/(panel)/super/security-events/page.tsx` |
| 04:50 | `src/app/api/v1/profiles/photos/[photoId]/file/route.ts` |
| 15:59 | `src/server/modules/otp/otp.repository.ts`, `src/server/modules/otp/otp.service.ts`, `tests/b19-admin-mfa.test.ts`, `tests/otp-core.test.ts` |
| 17:09 | `src/server/modules/admin/admin.service.ts` |
| 23:17 | `src/server/modules/groups/groups.service.ts` |

Three more changed on 2026-10-17 with the D-1 fix (commit `4262de9`): `src/server/modules/account/contact-change.service.ts`, `src/components/dashboard/ChangeContactFlow.tsx`, `tests/b19-contact-change.test.ts`. Only that test file has been run since (§1a).

The OTP core and admin login (MFA) changes are security-relevant. There is no saved evidence of a full run after them. **A fresh `npm test` run is the first QA action** (it needs the migrated and seeded test database; the suite truncates that database between files, so never point `.env.test` at real data).

## 2. Other verification on record (from earlier documents, not re-checked)

`FINAL_HANDOVER.md` §6 (PCP + B18 phase) reports: `tsc --noEmit` exit 0; production build OK; `smoke:prod` 123/123; `smoke:gateway` 52/52; `smoke:ui` 42/42; `smoke:ui-gateway` 35/35; `smoke:b18` 114/114; `smoke:b18-ui` 42/42. `COMMIT_1.txt` reports tsc, a production build and 786/786 tests from a clean B19 extraction. These predate the current `HEAD` and use mocks for every third party. No smoke output files are in the repository, so these numbers are taken from the documents as written.

## 3. How the suite is built

* Vitest 2, Node environment, `tests/setup.ts` loads `.env.test`.
* Prerequisites: an empty database named `rishteyzindagi_test` (`node scripts/create-test-db.cjs` creates it from `.env.test` and refuses any other name), then migrate and seed it against `.env.test` as described in `LOCAL_SETUP.md`. Run one file with `npx vitest run tests/<name>.test.ts`.
* Most tests call route handlers directly with constructed `Request` objects; no Next.js server is started. Exceptions: `pcp-backup` and `pcp-storage` spawn shell tools and a `moto_server` when available, and the smoke scripts run against a real production build.
* Third parties are replaced by local mocks in `tests/helpers/` (`mock-gateways.ts`, `mock-notify.ts`, `mock-otp.ts`, moto bootstrap for S3).
* Test files call `resetTransactionalTables()` from `tests/helpers/reset-db.ts` in their own hooks (`TRUNCATE … CASCADE`), so they share one database and must run sequentially.
* The shared rate-limit policy is off in tests unless `RATE_LIMIT_POLICY=on` (dedicated tests switch it on).
* Smoke scripts (`scripts/smoke/*.ts`, `npm run smoke:*`) run against a production build over real HTTP; UI checks need Playwright and Chromium, which are **not** in `package.json` and must be installed separately.

## 4. Coverage by area (test files)

| Area | Test files |
|---|---|
| Auth and OTP | `auth-register`, `auth-login`, `auth-otp-login-device`, `auth-forgot-password`, `otp-core`, `otp-config`, `otp-production-guard`, `pcp-otp`, `pcp-otp-prod-guard`, `registration-otp-switch`, `registration-otp-switch-smtp`, `b18-otp-policy`, `b19-admin-mfa`, `b19-contact-change` |
| Accounts and sessions | `pcp-account`, `b18-member-settings`, `security-regression`, `security-concurrency`, `qa-enumeration-resistance` |
| Profiles and photos | `profiles-update-completion`, `profiles-photos`, `profiles-public-view`, `profiles-reference-options`, `profiles-verification`, `profile-summaries` |
| Search and matching | `search-profiles`, `b18-search`, `partner-preferences`, `recommendations`, `behaviour-events`, `visibility-boost` |
| Interactions and chat | `interactions`, `qa-interactions-and-rbac-gaps`, `chat`, `b19-chat-stream` |
| Money | `membership-plans`, `memberships`, `payments`, `gateways`, `payments-production-guard`, `pcp-payments`, `pcp-payments-prod-guard`, `pcp-payments-resume`, `pcp-provider-setup`, `invoices`, `invoice-resend`, `admin-invoices-list`, `b18-plans`, `b18-reconcile`, `b19-dunning` |
| Notifications | `notifications`, `notifications-production-guard`, `pcp-notifications`, `push-tokens`, `b19-digest` |
| Admin and permissions | `rbac`, `b18-permission-matrix`, `b18-escalation`, `admin-users`, `admin-dashboard`, `admin-audit-logs`, `b18-security-events`, `b18-communities`, `b19-dashboard-security`, `b19-site-controls`, `pcp-security`, `pcp-bootstrap-admin` |
| Community and content | `b19-groups`, `b19-content`, `reports` |
| Platform | `health`, `health-ready`, `error-handling`, `db`, `smoke`, `pcp-foundation`, `pcp-jobs`, `pcp-storage`, `pcp-backup`, `prod-readiness`, `secret-scan`, `logger-redaction`, `run-tsx`, `b16-integration`, `mobile-integration`, `qa-boundary-conditions` |
| Performance | `perf-query-counts`, `performance-load`, `performance-concurrency`, `performance-pagination-stability`, `performance-redundant-indexes` |

Mapping is by file name and, for files marked READ/OUTLINED in the checklist, by contents. Individual test names are not yet mapped (next-session step 3).

## 5. Known test gaps

| Gap | Why it matters |
|---|---|
| No frontend unit or component tests (no React Testing Library or similar in `package.json`) | UI behaviour is covered only by the separate Playwright smoke scripts. |
| No test for payment activation failing after the payment is marked SUCCESS | See D-6 in `DECISIONS_AND_CHANGELOG.md`. |
| No test of the BFF cookie behaviour for contact change | The D-1 test checks the 403 status from the API handler; that the browser stays signed in through `/bff` is only inferred from `src/app/bff/[...path]/route.ts:172`. Check it in a browser. |
| No live vendor test (Razorpay, PhonePe, Fast2SMS, SMTP, FCM, WhatsApp, S3) | Everything is mock-verified only. |
| Backup and S3 tests skipped in the last run | Tools not installed on that machine. |
| Load test numbers are from a local machine | `tests/performance-load.test.ts` measures in-process latency; not a production benchmark. |
| No CI | Tests only run when someone runs them by hand. |
| Android client | Only simulated via bearer-token calls in `mobile-integration`; no app exists. |

## 6. Manual QA checklist before any release (proposed)

1. `npm test` against the test database: expect 0 failed; investigate any new skip.
2. `npx tsc --noEmit` and `npm run build`.
3. `npm run check:prod-env` with the production environment: 0 errors.
4. `npm run smoke:prod` and `smoke:gateway` against a production build.
5. Manual flows in a browser: sign-up with OTP; login from a new device; e-mail change with a wrong password and a wrong code (must stay signed in; D-1 fix); search with and without a plan; interest → accept → chat; checkout in Razorpay **test** mode; invoice download; account deletion and recovery; Super Admin settings; Staff Admin permission limits.
6. Live vendor checks with test credentials, per `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md`, `PROVIDER_TEST_SETUP.md`.

## 7. QA log

Dated entries, newest last. Earlier sections describe the state before each entry and are kept as written.

### 2026-10-17 — Full suite at `4262de9`/`f845812`, D-1 browser QA, login-timing investigation

**Status: the full suite is NOT green.** `npm test` exited 1 because of one timing assertion. Isolated reruns of that file passed, but the full run itself did not.

#### Verified observations

Full suite (one run, 01:00:29–01:31:23 IST, local test database `rishteyzindagi_test`):

| Measure | Result |
|---|---|
| Command | `npm test` (`vitest run`) |
| Exit code | **1** |
| Test files | 91: 89 passed, 1 failed, 1 skipped |
| Tests | 820: **799 passed, 1 failed, 20 skipped** |
| Duration | 1,850.4 s (about 30.8 minutes) |
| Only failure | `tests/performance-load.test.ts` › `[perf-load-login] POST /auth/login`: `AssertionError: expected 3716 to be less than 3000` at line 238 |
| Other performance checks | The other 8 checks in `performance-load.test.ts` passed, as did `perf-query-counts`, `performance-concurrency`, `performance-pagination-stability` and `performance-redundant-indexes` |
| Skips | 12 in `pcp-backup` and 8 in `pcp-storage`: the backup tools (`pg_dump`, `pg_restore`, `psql`, `gpg`) and the `moto_server` S3 mock are not installed |
| Server 5xx in test request logs | 15, in passing tests: 14 × 503 (webhooks, checkout, refunds, Razorpay resume, register, profile update, search) and 1 × 500 (`/admin/matching/weights`, a missing `matching_weight_configs` row during `b18-permission-matrix`, also logged once on 2026-10-11). The 2026-10-11 run logged 17 in total. Whether each one is intended was not checked test by test. |
| `npx tsc --noEmit` | exit 0 |

The test count rose from 814 (2026-10-11) to 820.

Login-timing investigation:

* **What the test measures:** 20 logins in 4 waves of 5 concurrent requests; p95 is the nearest-rank value (19th of 20). Each login is dominated by one `bcryptjs` cost-12 comparison.
* **Standalone check (no database, nothing else running):** one comparison took 320–342 ms (median 330 ms over 10). Five concurrent comparisons took 1.61–1.65 s of wall time with CPU time equal to wall time, so they run one after another on Node's single JavaScript thread, and a wave costs about 5 × one comparison.
* **Failing full-suite run:** the four waves took 1.79, 3.14, 3.15 and 3.71 s, all between 01:19:32 and 01:19:44 IST, in the same process. In the 2026-10-11 passing run every wave took about 1.6 s (p95 1,627 ms).
* **The rest of the same file was also slower:** p50 for search was 272 ms (80 ms on 2026-10-11), recommendations 62 ms (22 ms), notifications 29 ms (9 ms).
* **No login-path change:** none of the login route, auth controller and service, users repository, password and session libraries, error-handling and rate-limit middleware, maintenance gate, audit service, database client, logger, the test file, its helpers, `vitest.config.ts` or `package-lock.json` changed between the passing run and this one.
* **Three isolated reruns** of `npx vitest run tests/performance-load.test.ts` (01:34–01:35 IST, nothing else running): each passed 9/9, with login p95 of 1,674, 1,683 and 1,696 ms against the 3,000 ms threshold.

D-1 browser QA (local dev server, a new `@example.com` QA member, SMTP not configured and dev-OTP mode on, so no e-mail or SMS was sent):

| Check | Result |
|---|---|
| Contact-change form loads in Settings | PASS |
| Empty fields keep "Send code" disabled | PASS |
| Malformed e-mail rejected (400, "A valid e-mail address is required.") | PASS |
| Wrong password returns 403 with "That password is not correct." and the member stays signed in (e-mail and mobile) | PASS |
| Wrong code returns 403 with "That code is invalid or has expired." and the member stays signed in | PASS |
| Correct code updates the e-mail / mobile and marks it verified | PASS |
| The other session is revoked (401); the current session is kept | PASS |
| A used code cannot be reused (403, still signed in) | PASS |
| The old e-mail can no longer sign in; the new one can | PASS |
| Server errors | None: no 5xx in the browser or the dev-server log |

Minor findings, not D-1 failures: a 2-digit mobile number shows the raw validator text "Too small: expected string to have >=3 characters", and the change-password text briefly reads "sent to ." while the page loads.

#### Interpretation

* **Best-supported explanation:** a temporary slowdown of the machine or Node runtime during that window. The same code, in the same process, slowed down mid-test (one wave at normal speed, three waves about 2× slower), endpoints that do not use bcrypt slowed by a similar factor, and isolated reruns were back to normal. There is no evidence of an application-code, database or test-logic regression.
* **Not confirmed:** the specific cause of the slowdown. Hypotheses, none verified: Windows moving the process onto a slower core of this hybrid i7-12650H; reduced clock speed under the Balanced power plan (a snapshot afterwards showed the CPU at 50–77% of base speed while mostly idle, on AC power); brief load from other programs.
* **Test design:** this check depends on single-thread CPU speed. The normal p95 on this machine is about 1.7 s, so it fails whenever that speed drops by about 1.8× or more for a few seconds. Its code comment ("Isolated P95 is ~2.7s") does not match what this machine measures. No threshold or test was changed.

#### Next action (not done)

Re-run the full suite on a quiet machine before the next release. If the timing check fails again, consider making it less sensitive to machine speed (owner decision).
