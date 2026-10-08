# Release readiness matrix — Production Completion Phase

**How to read the labels**

| Label | Meaning |
|---|---|
| **VERIFIED** | Executed and observed in this phase (automated test, real-HTTP smoke test, or browser check). Evidence column names it. |
| **NOT VERIFIED** | Not exercised against the real thing. |
| **REQUIRES EXTERNAL CREDENTIALS** | Code is implemented and tested against a protocol mock; it cannot be proven live without your vendor account/keys. |
| **LOCAL ONLY** | Works on a developer machine; production use needs the owner's infrastructure. |
| **PRODUCTION READY** | Implemented, VERIFIED, and needs nothing external except normal deployment. |

"Mock" always means a local server written to reproduce the vendor's documented request/response shapes (S3: `moto` and botocore's SigV4 reference). A mock proves *our* code behaves correctly; it cannot prove the vendor accepts your account.

Test commands: `npm test` (66 files), `npm run smoke:prod`, `npm run smoke:gateway`, `npm run smoke:ui`, `npm run smoke:ui-gateway`. Exact counts of the final run are in `PCP_FINAL_REPORT.md`.

## Capabilities

| # | Capability | Code & logic | Against the real vendor | Label | Evidence |
|---|---|---|---|---|---|
| A1 | Exactly one active gateway (Razorpay or PhonePe), admin-controlled, audited | VERIFIED | n/a | **PRODUCTION READY** | `pcp-payments.test.ts`, gateway smoke, `ui-gateway` |
| A2 | Credentials stored encrypted, never returned or logged | VERIFIED | n/a | **PRODUCTION READY** (set `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`) | `pcp-payments.test.ts`, `pcp-security.test.ts` "secret exposure", smoke |
| A3 | Razorpay order → confirm (HMAC) → server-side re-verify → activate; resume of an unpaid order | VERIFIED vs mock | NOT VERIFIED | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-payments.test.ts`, `pcp-payments-resume.test.ts` |
| A4 | Razorpay webhook: HMAC over raw body, idempotent, retry-safe | VERIFIED vs mock | NOT VERIFIED | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-payments.test.ts`, gateway smoke |
| A5 | PhonePe v2 order / status / webhook (Authorization hash) / refund | VERIFIED vs mock | NOT VERIFIED; event-id behaviour undocumented (P3-4) | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-payments.test.ts`, gateway smoke |
| A6 | Client amount never trusted; amount/currency cross-check | VERIFIED | n/a | **PRODUCTION READY** | `pcp-payments.test.ts`, frozen B8/B10 tests |
| A7 | Refunds (partial/full, balance cap, failure frees balance, reconcile) | VERIFIED vs mock | NOT VERIFIED | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-payments.test.ts`, `pcp-jobs.test.ts` |
| A8 | Failed order creation leaves no orphaned PENDING rows | VERIFIED | n/a | **PRODUCTION READY** | `pcp-payments-resume.test.ts` `[checkout-failure-cleanup]` |
| A9 | Razorpay popup and PhonePe hosted page in a real browser | hand-off code VERIFIED | vendor pages never rendered (stubbed) | **NOT VERIFIED** | `smoke:ui-gateway` |
| B1 | OTP: exactly one active of EMAIL / FAST2SMS_SMS, atomic switch, in-flight codes stay valid | VERIFIED | n/a | **PRODUCTION READY** | `pcp-otp.test.ts` "switching providers with codes in flight", smoke |
| B2 | Email OTP over real SMTP (STARTTLS mandatory in production) | VERIFIED vs local SMTP server | deliverability NOT VERIFIED (SPF/DKIM/DMARC) | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-otp.test.ts`, prod smoke |
| B3 | Fast2SMS OTP send, safe logging (no codes/keys in logs) | VERIFIED vs mock | NOT VERIFIED; DLT template/balance are yours | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-otp.test.ts`, gateway smoke |
| B4 | Admin OTP provider screen | VERIFIED | n/a | **PRODUCTION READY** | `smoke:ui` |
| B5 | Dev OTP mode refused in production | VERIFIED | n/a | **PRODUCTION READY** | `pcp-otp-prod-guard.test.ts`, prod smoke |
| C1 | Account deletion + 30-day recovery (password + OTP), anonymise job, admin queue | VERIFIED | n/a | **PRODUCTION READY** (legal retention caveat P2-6) | `pcp-account.test.ts`, `pcp-jobs.test.ts`, prod smoke |
| D1 | Suspend / ban / unban / lift with mandatory reason, audit, RBAC, sessions revoked; auto-suspension preserved | VERIFIED | n/a | **PRODUCTION READY** | `pcp-account.test.ts` "admin moderation", frozen B6 tests, prod smoke, `smoke:ui` |
| E1 | Staff & role management, temporary passwords, Super Admin accounts protected from API changes, first Super Admin bootstrap | VERIFIED | n/a | **PRODUCTION READY** (no admin MFA, P2-7) | `pcp-account.test.ts`, `pcp-bootstrap-admin.test.ts`, prod smoke, `smoke:ui` |
| F1 | In-app notifications | VERIFIED | n/a | **PRODUCTION READY** | `pcp-notifications.test.ts` |
| F2 | SMTP / WhatsApp Cloud / FCM adapters; failures are recorded, never reported as sent | VERIFIED vs mock | NOT VERIFIED | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-notifications.test.ts` |
| G1 | S3-compatible storage: private objects, signed URLs, SigV4 | VERIFIED vs `moto` / botocore vectors | your bucket NOT VERIFIED | **REQUIRES EXTERNAL CREDENTIALS** | `pcp-storage.test.ts` |
| G2 | Magic-byte image validation, size limits, path-traversal protection, deletion | VERIFIED | n/a | **PRODUCTION READY** | `pcp-storage.test.ts` |
| G3 | Health endpoint proves storage *reachable* | not implemented (configuration only, P3-6) | – | **NOT VERIFIED** | – |
| H1 | Shared (Postgres) rate limiting, per-route policies, `Retry-After` | VERIFIED | n/a | **PRODUCTION READY** (set `TRUST_PROXY_HOPS`, P2-4) | `pcp-foundation.test.ts`, `pcp-security.test.ts`, prod smoke |
| H2 | CORS allow-list, `X-Device-Id`, security headers, cookies, origin CSRF, IDOR & RBAC sweeps of every route/method, webhook auth, secret exposure | VERIFIED | n/a | **PRODUCTION READY** | `pcp-security.test.ts` (route sweeps), prod smoke, `smoke:ui` |
| H3 | Strict (nonce-based) CSP | not built; CSP keeps `'unsafe-inline'` (P2-2) | – | **NOT VERIFIED** | – |
| I1 | Membership expiry, reminders, renewal-needed notices, payment reconcile, deletion finalise, housekeeping — idempotent, locked, audited, cron- and HTTP-compatible | VERIFIED | n/a | **PRODUCTION READY** once *you* schedule them | `pcp-jobs.test.ts`, prod smoke |
| I2 | Auto-renew charging a card without the member present | not possible with the current gateway integrations (P2-5) | – | **NOT VERIFIED** (by design) | – |
| J1 | Encrypted backup, off-box copy (directory or S3-compatible), retention guidance, restore verification, no secrets in artifacts | VERIFIED locally (restore into scratch DB) | an off-box target of yours never contacted | **LOCAL ONLY** until you configure an off-box target | `pcp-backup.test.ts`, `BACKUP_DR.md` |
| K1 | Clean install: `npm ci`, migrate from an empty DB, seed, `tsc`, full test suite, build, real-HTTP smoke, clean export | VERIFIED | n/a | **PRODUCTION READY** | `PCP_FINAL_REPORT.md` |
| L1 | Every admin-managed feature has an admin API and a screen | VERIFIED | n/a | **PRODUCTION READY** (exception: membership plans have no editor, P2-3) | `smoke:ui`, `smoke:ui-gateway` |
| M1 | Documentation set | present | – | **PRODUCTION READY** | this folder |

## What stands between this code and a live launch

1. **Your accounts and keys** — Razorpay and/or PhonePe, Fast2SMS (with a DLT-approved template), SMTP, optionally WhatsApp/FCM, an S3-compatible bucket. Nothing here can be proven live without them.
2. **Your infrastructure** — HTTPS, a reverse proxy (set `TRUST_PROXY_HOPS`), a scheduler for the six jobs, an off-box backup target and a passphrase kept off the server.
3. **Real plan prices** (P2-3) and your privacy-policy wording for account deletion (P2-6).
4. **A go-live rehearsal** with test-mode keys, following `PAYMENT_SETUP.md` §6, `FAST2SMS_SETUP.md` §5 and `DEPLOYMENT_PRODUCTION.md` §8.

Until those are done, the honest status is **backend complete in code and verified locally; live third-party behaviour unverified**.
