# Production Completion Audit (read-only audit, written BEFORE any code)

Phase: **PCP — Production Completion Phase** (follows B16b, which closed as *LOCAL-COMPLETE / PRODUCTION-PARTIAL*).
Date: 2026-10-08. Baseline snapshot for the freeze diff: `prod-phase-baseline/` (copy of the repo at B16b-final, no `node_modules`/`.next`).

Instruction followed: *"START WITH READ-ONLY AUDIT. WRITE THE AUDIT BEFORE CODE. THEN IMPLEMENT. STOP IF A FROZEN-PHASE CONFLICT IS DISCOVERED."*

Status labels used in this phase (and in every later document):

| Label | Meaning |
|---|---|
| **VERIFIED** | Executed in this phase against real PostgreSQL / real HTTP / a local protocol-accurate test server, with the evidence named. |
| **NOT VERIFIED** | Code exists but the live third-party service was never contacted. |
| **REQUIRES EXTERNAL CREDENTIALS** | Cannot be exercised without an account/credential only the owner can supply. |
| **LOCAL ONLY** | Works in dev/test only (dev providers, in-memory stores). |
| **PRODUCTION READY** | VERIFIED *and* needs no external credential to be correct (credentials only enable it). Never applied to a third-party integration that has not been contacted live. |

---

## 1. What was read

Repository source (all of `src/server`, `src/app/api/v1`, `src/middleware.ts`, `next.config.js`, `src/lib/api`, `src/lib/bff`, `src/components/admin`, `scripts/`, `drizzle/`), `BACKEND.md` (freeze policy §0–0c, §52 payments, §53 admin, §54 security, §58 DR, §60–61), the 18 phase-status docs (`docs/phase-status/`), `B16_AUDIT.md`, `B16_FINAL_REPORT.md`, `B16_RELEASE_READINESS.md`, `FINAL_HANDOVER.md`, the existing test suite (53 files / 476 tests), the frontend API usage (typed client + `/bff` proxy + admin components), and the previous *Backend Final Completion Audit* (verdict: PARTIAL — local-complete, production gaps).

Official provider contracts consulted (fetched in this phase, not recalled from memory):

* **Razorpay** — Orders API (`POST https://api.razorpay.com/v1/orders`, HTTP Basic `key_id:key_secret`, `amount` in paise, `receipt` ≤ 40 chars, order status `created|attempted|paid`; *an order maps 1:1 to a payment attempt*), Standard Checkout signature (`hex(HMAC-SHA256(order_id + "|" + razorpay_payment_id, key_secret))`, compared with `razorpay_signature`, using the **server-stored** `order_id`), webhooks (`X-Razorpay-Signature` = `hex(HMAC-SHA256(raw body, webhook_secret))`; duplicates possible → dedupe on `x-razorpay-event-id`), refunds (`POST /v1/payments/{id}/refund`, `amount`, `speed`, `notes`, `receipt`; status `pending|processed|failed`, id prefix `rfnd_`).
* **PhonePe Standard Checkout (current PG API)** — OAuth client-credentials token, `Authorization: O-Bearer <token>`, create payment `/checkout/v2/pay`, order status, refund `/payments/v2/refund` + refund status, webhook authentication `Authorization: SHA256(username:password)`. Exact paths/field names are re-read from the official reference when the adapter is written (task P2) and cited in the adapter's header comment. **No undocumented behaviour will be invented.**
* **Fast2SMS** — official OTP API: `POST https://www.fast2sms.com/dev/otp/send` (header `Authorization: <API key>`; JSON `mobile` = 10-digit Indian number, `otp_id` = DLT OTP template id, optional **`otp` = caller-supplied value (≤ 10 chars)**, `otp_length`, `otp_expiry` minutes, `variables_values`); success `{"return":true,"status_code":200,"request_id":…}`, errors `{"return":false,"status_code":400|401,"message":…}`. `POST /dev/otp/verify {mobile, otp}` (200 verified / 400 invalid-expired-exhausted / 404 not found-or-already-verified) and `POST /dev/otp/resend {mobile}` (10-min window, max 5) also exist. *Rate limits and 5xx shapes are not documented.*

---

## 2. Verified current state (what actually exists)

### 2.1 Payments
* Provider abstraction `PaymentGatewayProvider {name,isConfigured,createOrder,verifyPayment,testConnection}`; factory keyed by the five seeded gateway names; dev provider only when `NODE_ENV !== production`.
* **All five real providers are scaffolds that always throw** `ServiceUnavailableError`. No HTTP call to any gateway exists. **No webhook route. No refund API.** The model has `payment_status = PENDING|SUCCESS|FAILED|REFUNDED` and `invoices.status = ISSUED|PAID|VOID` but nothing writes `REFUNDED`.
* Credentials are stored AES-256-GCM encrypted in `payment_gateways.config` (`PAYMENT_CREDENTIALS_ENCRYPTION_KEY`); admin APIs list/update/activate/deactivate/test; `setActiveGateway` is a DB transaction (deactivate all → activate target) so **two active gateways is unrepresentable through the API**; every change is audited with field names only.
* Checkout takes only `planCode`; **amount/currency come from the `membership_plans` row** (`plan.priceInPaise`), never from the client (VERIFIED by source and by existing tests). Verify cross-checks gateway-reported amount/currency against the stored payment (B10), is replay-safe and race-safe.
* Checkout response carries no client-side data a real gateway needs (Razorpay Checkout needs `key_id` + order id; PhonePe needs a redirect URL).

### 2.2 OTP
* `otp_configs` singleton (`CHECK id = 1`), `otp_method = SMS|WHATSAPP|EMAIL`, atomic single-active guaranteed by schema. Codes stored as keyed hashes; purposes SIGNUP/LOGIN/FORGOT_PASSWORD/NEW_DEVICE are isolated; attempt limit, expiry, resend window all enforced.
* **All three delivery providers are scaffolds that throw.** EMAIL is *also* a scaffold — there is no working email delivery of any kind.
* Verification looks up `(identifier, purpose)` and **never consults the currently active channel** → switching the provider cannot invalidate an in-flight code (VERIFIED by source; will be proven by test).
* **Defect found (not a frozen-phase conflict, handled additively):** SIGNUP builds the identifier from the active channel (email or `+<cc><mobile>`), but LOGIN / FORGOT_PASSWORD / NEW_DEVICE always use the **email** as `identifier` and therefore as the provider `to`. An SMS provider would be handed an e-mail address. Resolution: the new Fast2SMS adapter resolves the destination mobile from the identifier (mobile → use; e-mail → look up the member; SIGNUP-in-flight → the OTP row's metadata). No change to `auth.service.ts`.

### 2.3 Account lifecycle
* Schema already has `account_status = ACTIVE|SUSPENDED|DELETED_PENDING|DELETED|BLOCKED`, `users.deleted_at`, `recovery_logs`. **No code ever sets DELETED_PENDING/DELETED/BLOCKED and nothing references `recovery_logs`.**
* `authenticate()` and every login path reject any status ≠ ACTIVE (VERIFIED in source: `authenticate.ts`, `auth.service.ts` ×5), so a pending-deleted / deleted / banned account **cannot authenticate** the moment its status changes. Search only returns `users.status = ACTIVE`; the profile read returns `userStatus` for gating.

### 2.4 Moderation
* Automatic suspension at 5 unique reporters (`REPORT_SUSPENSION_THRESHOLD`) with an `account_suspensions` row (partial unique index → one active suspension per user); `liftSuspension` (`users.suspend`); warnings (`warnings.issue`).
* **Missing:** an admin-initiated *suspend*, a *ban/block*, an *unban*. `account_status = BLOCKED` exists but is never written.

### 2.5 Staff management
* `admin_users`, `admin_roles`, `permissions`, `role_permissions` exist and RBAC resolves by role name → permission rows. `staff.manage` permission is **seeded and used by nothing**. No list / create / role / disable API. UI explicitly says "not available yet". Staff accounts are created by SQL.
* Admin login and `authenticate()` already reject `admin_users.status ≠ ACTIVE`.

### 2.6 Notifications
* `notify()` is best-effort with a `dedupeKey`, IN_APP inserts directly. EMAIL / WHATSAPP / PUSH providers are scaffolds that throw (`status = FAILED`, never fabricated). Push addressing from `device_push_tokens` exists (B11).

### 2.7 Storage
* `StorageProvider {upload,read,delete}`; only `local` implemented; any other `STORAGE_PROVIDER` fails loudly. Photos: ≤ 5 MB, ≤ 10 per profile, magic-byte image inspection (`image-inspect.ts`), served only through the cookie-gated route (never a raw public URL). Storage keys are server-generated.

### 2.8 Rate limiting / security
* `checkRateLimit(key, limit, windowMs)` is a **synchronous in-memory** fixed window — correct for one process only. ≈ 59 handlers have no limiter (mostly reads; also `createMyProfile`, photo primary/reorder/delete, `verifyProfile`, `logout`, `logout-all`, `GET /profiles/{id}`).
* `middleware.ts`: env-driven CORS, `Access-Control-Allow-Headers: Content-Type,Authorization` → **`X-Device-Id` is not allowed cross-origin** (the mobile/web clients that send it cross-origin fail preflight). API security headers present; page headers in `next.config.js` (B16b); **no CSP**.
* Cookies: `rz_session` Lax httpOnly, `rz_admin_session` Strict httpOnly, `Secure` in production; BFF CSRF origin check. Tokens are opaque and hashed in DB.

### 2.9 Membership automation
* Expiry is **lazy** (flipped on read in `memberships.repository.ts`); renewal reminder and auto-renew attempt are *member-triggered* POSTs. **No scheduler, no job table.** Real recurring auto-debit needs gateway mandates/subscriptions — not implemented anywhere.

### 2.10 Backup
* `scripts/backup-db.sh` (pg_dump -Fc, 7 daily + 4 weekly retention, `backups` bookkeeping), `scripts/restore-db.sh`, `BACKUP_DR.md`. **No encryption, no off-box destination, no restore-verification script.** `pg_dump` includes `device_sessions` token hashes.

---

## 3. Frozen-phase conflict check (required by the instruction)

I searched the existing tests and source for assertions that the new product decisions would contradict.

| # | Product decision | Frozen assertion found | Conflict? | Resolution |
|---|---|---|---|---|
| C1 | Only **Razorpay + PhonePe** may be active | `tests/gateways.test.ts` `gw-list` expects **5** gateways; `gw-activate` activates **Cashfree** through `POST /admin/payment-gateways/{id}/activate` and expects 200 | **Yes — direct** if the legacy route were restricted in all environments | **No frozen test is edited.** The restriction is a *production-only* guard (`NODE_ENV === production`) added to the legacy activate path, using the same environment-guard idiom the codebase already uses for dev providers. The **new** admin API (`/admin/payments/config`) enforces Razorpay/PhonePe-only in **every** environment, and the admin UI uses only the new API. Cashfree/PayU/Paytm rows stay in the table (no deletion of working functionality) but can never be activated in production. |
| C2 | OTP provider values = `EMAIL` / `FAST2SMS_SMS` only | `tests/otp-config.test.ts` PATCHes `activeMethod: "SMS"` and expects 200 + `SMS`; a 400 test uses an invalid string | **Yes — direct** if the legacy enum were changed | The `otp_method` enum is **not changed**; `FAST2SMS_SMS` is the API-level name for the stored value `SMS`. New routes `GET/PATCH /admin/otp/provider` speak `EMAIL`/`FAST2SMS_SMS`. The legacy `PATCH /admin/otp/config` keeps accepting `SMS|WHATSAPP|EMAIL` in non-production (tests), and **rejects `WHATSAPP` in production**. |
| C3 | Notification providers become real | `tests/push-tokens.test.ts` expects an unconfigured PUSH notification to end `FAILED` with `/not configured|no real vendor/` | No | Real adapters keep `isConfigured()` false and the same "not configured" failure when env is unset (the case the tests exercise). |
| C4 | Staff management | Nothing asserts "no staff API" except the UI text | No | UI text replaced (frontend, not a frozen backend contract). |
| C5 | Shared rate limiter | Existing tests call controllers with sync `checkRateLimit` and `__resetRateLimitsForTests` | No | The sync limiter is untouched; a **new** async, store-backed limiter is applied centrally (see §4-H). Default store in `NODE_ENV=test` = memory, so no existing test changes behaviour. |
| C6 | Account deletion | `authenticate` / login paths already reject non-ACTIVE; `search` only ACTIVE | No — it relies on them | — |
| C7 | New tables (webhook events, refunds, bans, job runs, rate-limit counters) | `tests/db.test.ts` (B1) asserts **exactly 52 tables** (`tableNames.length === expected.length`) and exactly the two roles `["STAFF_ADMIN","SUPER_ADMIN"]` | **Yes — direct.** Found during this audit (first draft of this row wrongly said "checked, no conflict"; corrected after actually reading the test) | **Owner decision obtained (2026-10-08): update the exact-count list**, following the B5 / B6 / B11 precedent. This is the **only frozen-test edit** in the phase. Migration is otherwise additive. The roles assertion is respected by never leaving custom roles behind in tests (they are removed in `afterAll`; the DB is reset between files anyway). |

**Result.** C1 and C2 would collide with frozen tests if implemented the obvious way; both are resolved additively (no frozen test edited, no behaviour removed) and `gateways.test.ts` / `otp-config.test.ts` must stay green untouched. C7 is a real conflict that was **stopped on and put to the owner**, who chose to update the count assertion (precedent B5/B6/B11).

If any later step reveals a conflict that cannot be resolved additively, work stops and is reported before proceeding.

---

## 4. Gap list and design (per brief section)

### A. Payment — Razorpay + PhonePe, one active
* **Single source of truth**: `payment_gateways.is_active` + existing `setActiveGateway` transaction. New `payments/config` module exposes `GET /admin/payments/config` (active gateway, per-gateway status: `configured` = decryptable DB credentials *or* env credentials, `mode`, `webhookConfigured`, `webhookUrl`, last-update) and `PATCH /admin/payments/config {activeGateway: "RAZORPAY"|"PHONEPE"}` (atomic switch; refuses an unconfigured target in production; audit `payment_gateway.switched` with before/after names). Credentials written via `PUT /admin/payments/config/{gateway}/credentials` (write-only, encrypted, never echoed; audit lists field names only). Both under `platform.settings.manage`. `POST /admin/payments/config/{gateway}/test-connection` performs a **safe read** (Razorpay: `GET /v1/orders?count=1`; PhonePe: obtain an OAuth token) — no money moves.
* **Providers become real** (`razorpay.provider.ts`, `phonepe.provider.ts` replaced; Cashfree/PayU/Paytm untouched): credentials resolved lazily inside the async methods (DB-encrypted first, env fallback) so the synchronous factory/`isConfigured()` contract is unchanged; `fetch` with `AbortController` timeout; secrets never logged; HTTP errors mapped to `ServiceUnavailableError`/`ValidationError` with no secret or raw body echoed.
  * Razorpay `createOrder`: `POST /v1/orders` with `amount` = **plan price from DB**, `receipt` = internal transaction ref (≤ 40). `verifyPayment`: `GET /v1/orders/{id}/payments` → SUCCESS only if a `captured` payment exists, returning the gateway's amount/currency/payment id (so B10's cross-check applies); otherwise PENDING (an order may be retried in Checkout; a stale PENDING is closed by the reconciliation job). Browser confirmation route `POST /payments/{paymentId}/razorpay/confirm {razorpay_payment_id, razorpay_order_id, razorpay_signature}` verifies the HMAC with the **server-stored** order id (constant-time) and then runs the *same* server-to-server verify — the client-supplied signature can only ever *reject*, never *grant*.
  * PhonePe: per the official reference (token → create payment → order-status → refund/refund-status); amount again from the plan; merchant order id = internal transaction ref.
  * Checkout response gains an **additive** `gatewayCheckout` object (`{provider:"RAZORPAY", keyId, orderId, amount, currency}` or `{provider:"PHONEPE", redirectUrl}`) — `keyId` is the *public* Razorpay key id; the secret never leaves the server. Dev provider unchanged.
* **Webhooks** (`POST /api/v1/webhooks/razorpay`, `POST /api/v1/webhooks/phonepe`): unauthenticated by session but **authenticated by signature** (Razorpay HMAC over the raw body with the webhook secret; PhonePe Authorization header per the official contract), constant-time compare, size cap, `req.text()` raw body, rate-limited, 401 on bad signature, 200 fast on duplicates. New table `payment_webhook_events (provider, event_id)` UNIQUE → **idempotent**. A webhook is only an *authenticated trigger*: the handler re-fetches the order/payment status from the gateway and runs the existing race-safe `resolvePaymentOutcome`, so a forged or replayed payload can never activate a membership or change an amount.
* **Refunds** (`POST /admin/payments/{id}/refund {amount?, reason}`; `payments.review`): new table `payment_refunds`; Razorpay/PhonePe refund calls; amount ≤ remaining refundable; full refund sets `payments.status = REFUNDED`, ends the linked membership (`CANCELLED`) and voids the invoice; refund webhook/status poll finalizes `PENDING → PROCESSED|FAILED`. Audited.
* **Reconciliation job** (see I): PENDING payments older than a threshold → provider status → resolve; closes stale PENDING as FAILED so the B8 409 "payment already pending" window cannot trap a member.
* Limits: PhonePe/Razorpay *live* behaviour cannot be exercised without merchant accounts → **REQUIRES EXTERNAL CREDENTIALS / NOT VERIFIED live**. Tests use protocol-accurate local mock servers (base URLs overridable by env **only when `NODE_ENV ≠ production`**).
* Recurring auto-debit (mandates/subscriptions) is **not** implemented and is documented as a known limitation; failed-renewal handling = notify + audit.

### B. OTP — EMAIL + FAST2SMS_SMS, exactly one active
* New `GET /admin/otp/provider` → `{active, providers:[{key, label, configured, status}], devMode, updatedAt}` (never secrets) and `PATCH /admin/otp/provider {activeProvider}` → one `UPDATE … WHERE id = 1` (atomic; no window with zero/two active), audit `otp_config.provider_switched`, rate-limited, `platform.settings.manage`. In production a switch to an *unconfigured* provider is refused (409) because it would break signup/login; dev/test may switch freely. Existing OTP rows are untouched (no invalidation).
* **EMAIL**: real SMTP adapter (`nodemailer` — new dependency) used by OTP *and* email notifications; env `EMAIL_PROVIDER=smtp`, `SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM`; timeouts; plain-text template; OTP never logged. Tested against a local SMTP test server (real protocol round-trip).
* **FAST2SMS_SMS**: adapter on the official OTP API `POST /dev/otp/send` with `otp_id` (`FAST2SMS_OTP_ID`), `mobile` (10-digit, normalized from `+91…`; non-Indian numbers rejected), caller-supplied `otp` (the code the application generated and hashed), `otp_expiry` from the platform setting; API key from `FAST2SMS_API_KEY` (never DB/hardcoded); 10 s timeout; maps `return:false`/401/400/network → safe `ServiceUnavailableError`; logs only `request_id`/status.
* **Verify design (decision, documented):** the application remains the authority on verification (hashed code, purpose isolation, attempt counting, single use, tickets). Fast2SMS `/dev/otp/verify` is **deliberately not called**: it is keyed by mobile only (no purpose), returns 404 for an already-verified code, and would double-count attempts and break the purpose-separation/ticket flow the brief requires keeping. "Real verify where appropriate" is therefore satisfied by the app-level verify of a code that was **really delivered** by Fast2SMS.
* WHATSAPP remains in the enum (frozen schema) but is unreachable via the new API and rejected in production on the legacy API.

### C. Account deletion + recovery (reuses existing schema, no new status)
* `POST /users/me/delete-account {password, confirmation: "DELETE MY ACCOUNT"}` — authenticated **and** re-authenticated by password (constant-time bcrypt), sets `status = DELETED_PENDING`, `deleted_at = now`, revokes **all** sessions, turns off auto-renew, writes `recovery_logs` (`action = DELETION_REQUESTED`) + audit. Profile disappears from search/public view immediately (status ≠ ACTIVE).
* Recovery window: **30 days** (`ACCOUNT_RECOVERY_WINDOW_DAYS`, default 30, documented). Recovery works while logged out and needs **both** knowledge factors: `POST /auth/recover-account/request {email, password}` (generic response always — no enumeration; OTP purpose `ACCOUNT_RECOVERY`, added by an additive `ALTER TYPE … ADD VALUE`) and `POST /auth/recover-account/confirm {email, code}` → `ACTIVE`, `deleted_at = NULL`, `recovery_logs` + audit. Outside the window → generic failure. There is no admin "recover on behalf" action (recovery only by the owner); admins get **read-only visibility** (`GET /admin/account-deletions`: pending list with days left; user detail shows `deletedAt`/deadline).
* Final deletion (job `account-deletion-finalize`): for `DELETED_PENDING` past the window → `DELETED`; PII anonymized (name, e-mail `deleted+<id>@deleted.invalid`, unique placeholder mobile, unusable password hash), profile photos removed from storage and DB, push tokens deleted, sessions already revoked; payments/invoices retained (accounting) — documented. Audited per user.
* IDOR: the target is always the session's own user id; no user id in any of these routes.

### D. Admin moderation
* `POST /admin/users/{id}/suspend {reason}` (`users.suspend`; reuses `account_suspensions` + its partial unique index; sets `SUSPENDED`; revokes sessions), `POST …/ban {reason}` and `POST …/unban {reason}` (new permission `users.ban`, SUPER_ADMIN by default; new table `account_bans` with a partial unique index on active ban; sets `BLOCKED`; ends any active suspension row so a later "lift suspension" can never resurrect a banned account; revokes sessions), existing `POST …/warnings` and `POST …/lift-suspension` untouched. Reason required (min 3 chars), RBAC after validation, cannot act on admin accounts or on self (members only), cannot suspend/ban a DELETED account; every action audited with reason. Automatic report-based suspension is untouched. Suspended/banned/deleted members already fail `authenticate()` (401) — will be re-verified over real HTTP.

### E. Staff management (reuses existing RBAC tables)
* `GET /admin/staff`, `POST /admin/staff` (create with a **server-generated one-time temporary password** shown once; no e-mail invite exists without a delivery channel), `PATCH /admin/staff/{id}` (name / role / enable-disable), `GET /admin/roles`, `POST /admin/roles`, `PUT /admin/roles/{id}/permissions`, `POST /admin/me/password`. All behind `staff.manage` (SUPER_ADMIN).
* Escalation/Super Admin protection: `SUPER_ADMIN` accounts and the `SUPER_ADMIN` role are **immutable via the API** (no create-as, promote-to, demote, disable, or permission edit); `staff.manage` can never be granted to a non-SUPER_ADMIN role; an admin cannot modify themself; permission keys validated against the `permissions` table; role/permission/disable changes revoke the target's sessions immediately; every action audited (actor, target, before/after).
* Per-role (not per-user) permissions is the existing architecture; "update permissions where architecture permits" = edit a *non-super role's* permission set / assign a staff member to a role. No parallel RBAC is introduced.

### F. Notifications (provider abstraction already exists)
* EMAIL → the SMTP adapter. WHATSAPP → Meta WhatsApp Cloud API adapter (`POST /{version}/{phone-number-id}/messages`, Bearer token, template/text). PUSH → FCM HTTP v1 adapter (service-account RS256 JWT → OAuth token → `messages:send`, using Node `crypto`, no SDK). Each: config validation in `isConfigured()`, timeout, safe error mapping, **no fake success**, status `SENT`/`FAILED` exactly as today. All three are **NOT VERIFIED live / REQUIRES EXTERNAL CREDENTIALS**; protocol-tested against local mock servers; "PRODUCTION READY" is **not** claimed for any of them.

### G. Storage (S3-compatible)
* `S3StorageProvider` (`STORAGE_PROVIDER=s3`; `S3_ENDPOINT` (optional, for MinIO/R2/Spaces), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`): hand-written **AWS Signature V4** with Node `crypto` (no SDK) for PUT/GET/DELETE and **presigned GET** (time-limited); private bucket assumed (no public ACL ever set); key validation (server-generated safe charset, no `..`, no leading `/`, length cap) in **every** provider including local; content-type allow-list; the existing size/magic-byte checks stay in the service. Photos continue to stream through the authenticated route (no raw public URL). Signature correctness is checked against AWS's published SigV4 test vectors and a local S3-compatible mock server → **VERIFIED (protocol)**; connectivity to a real bucket → **NOT VERIFIED / REQUIRES EXTERNAL CREDENTIALS**. Migration helper `scripts/migrate-storage.ts` (local → S3, idempotent, dry-run).

### H. Rate limiting + security
* New **async, store-backed** limiter: `RATE_LIMIT_STORE=postgres|memory` (production default **postgres**; memory in dev/test and explicitly labelled *single-instance only* in `/health/ready`). Postgres store = one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` per hit on new table `rate_limit_counters` (shared by every instance); `rate-limit-gc` job prunes. Applied **centrally** in `withErrorHandling` through a path-pattern policy table (additive hook, one touch of the B1 wrapper), so login, OTP request/verify/resend, signup, forgot/reset password, profile & photo mutations, public profile, interactions, payments, webhooks, admin login and admin config routes are all covered **without** editing ~90 controllers; existing in-controller sync limiters keep working (defence in depth). Client IP: `TRUST_PROXY_HOPS` aware, no blind trust of `X-Forwarded-For`.
* Add `X-Device-Id` to CORS allowed headers (and `Access-Control-Max-Age`); CORS stays env-allowlist driven; production refuses to start `check:prod-env` with an empty `ALLOWED_ORIGINS`.
* **CSP**: feasible as a *baseline* in production for pages (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, Razorpay script/frame/connect hosts, `img-src 'self' data: blob:`, Google Fonts) with `'unsafe-inline'` for script/style because Next 14 App Router injects inline bootstrap scripts (a nonce-based strict CSP is a documented follow-up). It will be verified in a real Chromium production build with zero CSP violations in the console. Dev mode is exempt (React Refresh needs `eval`).
* Reviewed and to be re-tested: cookie flags, CSRF origin check, IDOR on every new route (target ids derived from the session), RBAC on every new admin route (anonymous 401 / member 401-403 / staff-without-permission 403), webhook authentication, no secret in responses/audit/logs/client bundle.

### I. Membership expiry / automation (no permanent process)
* New table `job_runs` (name, run key, status, counters, error) + `jobs/` framework: advisory-lock guarded, idempotent, audited (`SYSTEM` actor). Jobs: `membership-expiry` (bulk flip + one dedupe-keyed notification), `membership-reminders` (expiry ≤ 3 days, deduped per day), `renewal-failed` (expired + auto-renew + no renewal → one "renew needed" notice; honest: no auto-debit), `payment-reconcile`, `account-deletion-finalize`, `housekeeping` (rate-limit counters, webhook event retention). Triggers: `POST|GET /api/v1/internal/jobs/{job}` protected by `Authorization: Bearer $CRON_SECRET` (constant-time, ≥ 32 chars, route 404 when unset) — compatible with any HTTP cron/Vercel-style cron/Cloud Scheduler — and `npm run job -- <name>` for system cron. `GET /admin/jobs` (read-only run history, `audit.view`).

### J. Backup
* Keep `backup-db.sh` / `restore-db.sh` unchanged. Add `scripts/backup-secure.sh` (pg_dump → AES-256 `openssl enc -pbkdf2` with a passphrase **file** — never on the command line; excludes data of `device_sessions`/`otp_codes`; writes SHA-256 sidecar; destination abstraction `BACKUP_DESTINATION=local|s3` where `s3` uses the SigV4 client above), `scripts/verify-restore.sh` (decrypt → `pg_restore` into a scratch database → row-count/constraint checks → drop), retention guidance and a restore-drill procedure in `BACKUP_DR.md`. The local encrypt → restore-verify round trip will be **executed for real**. Off-box delivery is **REQUIRES EXTERNAL INFRASTRUCTURE** unless/until it is run against a real bucket; I will not claim otherwise.

### K/L. Admin UI (every new admin API gets a screen)
* Settings → **Payments**: [Razorpay | PhonePe] cards (one active, status, configured?, mode, credentials form write-only, webhook URL + secret status, test connection, activate, audit hint). Settings → **OTP**: [Email | Fast2SMS] selector (active, configured/status, switch with confirm). **Users**: Suspend / Ban / Unban / Lift (+ Warn existing) with required reason; deletion-pending banner + days left; status filter includes `DELETED_PENDING`. **Staff & Roles**: list, create (one-time password dialog), change role, enable/disable, role-permission editor. **Revenue/Payments**: refund action. **Jobs**: read-only run history. Member side: *Delete my account* (re-auth), *Recover account* page, and Razorpay Checkout.js / PhonePe redirect in the checkout screen — otherwise the new payment backend would be disconnected from the member UI.

---

## 5. Planned changes to files that belong to frozen phases (all disclosed up front)

| File | Phase | Change | Class |
|---|---|---|---|
| `src/server/middleware/error-handler.ts` | B1 | call the central async rate-limit policy before the handler (no behaviour change when policy disabled/no match) | REQUIRED DEPENDENCY (shared limiter) |
| `src/middleware.ts` | B10 | `X-Device-Id` in allowed headers; production CSP for pages | SECURITY FIX |
| `src/server/modules/payments/providers/{razorpay,phonepe}.provider.ts`, `providers/factory.ts` | B8 | scaffolds → real adapters (same interface, same file, same names) | REQUIRED DEPENDENCY |
| `src/server/modules/payments/gateways.service.ts` | B8 | production-only supported-gateway guard on legacy activate; audit-friendly additions | PRODUCT DECISION (additive guard) |
| `src/server/modules/payments/payments.service.ts` | B8 | `gatewayCheckout` in checkout result; `payment-reconcile`/refund hooks use existing exported internals (export `verifyPaymentInternal` wrapper only) | REQUIRED DEPENDENCY |
| `src/server/modules/otp/providers/{email,sms,factory}.provider.ts` | B2 | scaffolds → real SMTP / Fast2SMS adapters | REQUIRED DEPENDENCY |
| `src/server/modules/otp/otp-config.service.ts` | B2 | reject `WHATSAPP` in production | PRODUCT DECISION (additive guard) |
| `src/server/modules/notifications/providers/{email,whatsapp,push}.provider.ts` | B7/B11 | scaffolds → real adapters | REQUIRED DEPENDENCY |
| `src/server/modules/storage/factory.ts`, `local-disk.provider.ts` | B3 | register `s3`; add key validation | REQUIRED DEPENDENCY / SECURITY FIX |
| `src/server/db/schema.ts` | B1 | new tables / enum value only (additive) | DATABASE MIGRATION REQUIRED |
| `src/server/db/seed.ts` | B1 | new permission rows (`users.ban`) — idempotent | DATABASE MIGRATION REQUIRED |
| `src/server/config/env.ts` | B1 | new optional env vars | REQUIRED DEPENDENCY |
| `src/components/admin/*`, member checkout/settings pages | B16b (frontend) | new panels; replace "not available yet" staff screen; checkout gateway handoff | feature work |
| `tests/db.test.ts` | B1 | add new tables to the exact-count expected list (owner-approved, C7) | DATABASE MIGRATION REQUIRED |
| `package.json` / lock | — | `nodemailer`, `smtp-server` (dev) | REQUIRED DEPENDENCY |

No other B1–B15 file is planned to change. B1–B15 tests are not edited. Any further frozen touch discovered during implementation will be added here and in the final report before/at the time it is made.

---

## 6. Test plan (nothing marked PASS from source inspection)

`npm ci`; migrate from an **empty** DB (all migrations); seed; `npx tsc --noEmit`; full `npm test` (existing 476 must stay green + new suites below); `npm run build`; real HTTP smoke on the built app; security (cookies/CSRF/headers/CSP in Chromium); RBAC matrix for every new admin route; IDOR for deletion/recovery/refund/payment-confirm; **OTP switching** (EMAIL↔FAST2SMS_SMS, in-flight code survives, audit row, one active); **payment switching** (Razorpay↔PhonePe, never two active, concurrent switch race); **webhook signature + idempotency** (bad sig 401, replay no-op, forged payload cannot activate); account deletion/recovery (sessions revoked, cannot log in, recover with password+OTP, window expiry, finalize job); moderation (suspend/ban/unban/lift/warn, ban not resurrectable via lift); staff RBAC (no escalation, Super Admin protected, session revocation); storage security (traversal keys rejected, SigV4 vectors, mock-S3 round trip); rate limit (shared store across two simulated instances/pools); jobs (idempotent re-run, secret required); backup encrypt → restore-verify; clean-export test (install → migrate → seed → tsc → test → build → start → health).

## 7. External dependencies that cannot be verified here

| Item | Needed from owner | Verified here |
|---|---|---|
| Razorpay | key id/secret, webhook secret, live/test mode | protocol-accurate local mock only → **NOT VERIFIED live** |
| PhonePe | client id/secret/version, webhook username/password | mock only → **NOT VERIFIED live** |
| Fast2SMS | API key, DLT-approved OTP template id (`otp_id`), balance | mock only → **NOT VERIFIED live** |
| SMTP | host/user/pass/from (SPF/DKIM at the sender domain) | local SMTP test server (real SMTP) → protocol VERIFIED, deliverability NOT VERIFIED |
| WhatsApp Cloud / FCM | Meta token + approved template / Firebase service account | mock only → **NOT VERIFIED live** |
| S3-compatible bucket | endpoint, bucket, keys | SigV4 vectors + mock → protocol VERIFIED, bucket NOT VERIFIED |
| Off-box backup target, hosting/TLS, secrets manager, monitoring | owner infrastructure | **REQUIRES EXTERNAL INFRASTRUCTURE** |

## 8. Decision

One frozen-phase conflict (C7) was found, stopped on, and resolved by explicit owner decision. Proceed to implementation in the order: P1 foundation (migration, shared limiter, jobs) → P2 payments → P3 OTP → P4 lifecycle/moderation/staff → P5 notifications/storage/backup → P6 security + tests → P7 docs, regression, clean export, final audit. **Freeze rule:** any open P0/P1 functional or security defect = DO NOT FREEZE.

---

## 9. Post-implementation status (appended after the work — sections 1–8 above are the unmodified pre-code audit)

Each gap found in §§2–6 was implemented and then tested; the evidence, with exact counts from the final regression run, is in `PCP_FINAL_REPORT.md`, and per-capability status labels are in `PCP_RELEASE_READINESS_MATRIX.md`. Gaps that cannot be closed without the owner's accounts remain labelled **REQUIRES EXTERNAL CREDENTIALS / NOT VERIFIED live** (§7) — they are implemented, not verified against the real vendor.

Defects found **during** verification that were not in this audit (all fixed and covered by tests): a wrong-password answer of 401 signed the user out through the browser proxy (now 403); a forged Razorpay signature did the same (now 400); `Retry-After` was dropped by the proxy (now relayed); a staff-table overflow at 375 px; abandoned Razorpay checkouts locked the member out of paying again for 15 minutes (resume endpoint added); and a gateway/credential failure during checkout left an orphaned PENDING payment with the same lock-out effect (now cleaned up). Open items are in `PCP_KNOWN_LIMITATIONS.md` (no P0/P1).
