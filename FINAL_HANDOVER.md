# RishteyZindagi — Final Handover (Production Completion Phase + B18)

One Next.js 14 application: public website, member dashboard, admin panel and REST backend (`/api/v1`), on PostgreSQL 16 with Drizzle. This document is the single entry point for whoever takes the system over. The previous (B16) handover is archived at `docs/B16_FINAL_HANDOVER_ARCHIVE.md`.

**Honest one-line status:** the backend is complete and verified locally (automated tests, real-HTTP smoke tests against a production build, headless-browser checks). Every third-party integration — Razorpay, PhonePe, Fast2SMS, SMTP, WhatsApp, FCM, S3 storage, off-box backup — is **implemented and tested against protocol mocks only**; none has been called live. Status per capability: `PCP_RELEASE_READINESS_MATRIX.md`.

## 1. Facts

| Fact | Value |
|---|---|
| API routes | 133 (24 added by the production completion phase, 13 by B18) |
| UI pages | 46 |
| Migrations / tables | 13 / 58 (`0011_pcp_production_completion.sql` and `0012_b18_admin_controls.sql` are additive) |
| Test files / tests | 75 / 716 |
| Frozen | B1–B15, B16a, B16b (see `PCP_KNOWN_LIMITATIONS.md` for the few frozen files that were edited, each for a documented defect or required integration point) |

## 2. Read in this order

0. B18 (latest phase): `B18_FINAL_REPORT.md`, `B18_RELEASE_READINESS_MATRIX.md`, `B18_KNOWN_LIMITATIONS.md`, `B18_PERMISSION_MATRIX.md`, `B18_AUDIT.md`.
1. `PCP_RELEASE_READINESS_MATRIX.md` — what is VERIFIED / REQUIRES EXTERNAL CREDENTIALS / LOCAL ONLY.
2. `PCP_KNOWN_LIMITATIONS.md` — every open P2/P3 item and every frozen-file edit.
3. `LOCAL_SETUP.md` — run it on your machine.
4. `DEPLOYMENT_PRODUCTION.md` + `PRODUCTION_ENV_REFERENCE.md` — deploy.
5. `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md` — vendor setup and go-live checklists.
6. `BACKUP_DR.md` (addendum on top) — backups and restore.
7. `PRODUCTION_COMPLETION_AUDIT.md` (pre-code audit + §9 post-implementation), `PCP_FINAL_REPORT.md` (evidence), `API_REFERENCE.md` §20, `BACKEND.md` §62.

## 3. Architecture in brief

```
Browser ─► /bff/*   same-origin session proxy: httpOnly cookies (rz_session member, rz_admin_session admin, rz_device_id),
              │      origin check on state-changing calls, session token never reaches JavaScript, Retry-After relayed,
              │      cookie cleared on any 401 from an authenticated call
              ▼
        /api/v1/*   route.ts → controller → service → repository → PostgreSQL
                    withErrorHandling: error envelope + shared Postgres rate-limit policy
        jobs        npm run job -- <name>   or   POST /api/v1/internal/jobs/<name> with Bearer CRON_SECRET
```

Secrets (gateway credentials, SMTP/Fast2SMS keys, S3 keys, `AUTH_SECRET`) exist only server-side; none is sent to a browser or mobile bundle, returned by an API, or written to logs or backups. Admin-saved gateway credentials are encrypted at rest (AES-256-GCM, key from `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`).

## 4. What each admin-managed feature uses

| Feature | Admin screen | Admin API | Permission |
|---|---|---|---|
| Active payment gateway, credentials, test connection | Super Admin → Platform Settings → *Payment gateway* | `/admin/payments/config*` | `platform.settings.manage` |
| Refunds | Super Admin → Revenue (refund dialog) | `/admin/payments/{id}/refunds` | `payments.review` |
| OTP delivery provider | Super Admin → Platform Settings → *OTP delivery provider* | `/admin/otp/provider` | `platform.settings.manage` |
| Suspend / ban / lift | Users (moderation panel in the user detail) | `/admin/users/{id}/suspend\|ban\|unban`, `/moderation` | `users.suspend`, `users.ban`, `users.view` |
| Account deletions queue | Account deletions | `/admin/account-deletions` | `users.view` |
| Staff and roles | Super Admin → Staff & Roles | `/admin/staff*`, `/admin/roles*` | `staff.manage` (role creation/permission edits: Super Admin only) |
| Own password | Forced "choose a new password" screen after a temporary password (no voluntary change screen yet; the API accepts it any time) | `/admin/me/password` | any admin |
| Membership plans | Super Admin → Membership Plans (B18) | `/admin/membership-plans*` | `plans.manage` |
| Communities pick-list | Super Admin → Communities (B18) | `/admin/communities*` | `communities.manage` |
| OTP policy (required / not required for new-device login and sign-up) | Super Admin → Platform Settings → *OTP policy* | `/admin/otp/policy` | Super Admin only |
| Search page size, advanced-search enforcement, sign-up open/closed | Super Admin → Platform Settings | `/admin/platform-settings` | `platform.settings.manage` |
| Security events feed, run reconciliation now | Super Admin → Security Events / Revenue | `/admin/security-events`, `/admin/payments/reconcile` | `audit.view`, `payments.review` |

## 5. Day-one checklist for the owner

1. Create the production environment from `.env.example`; run `npm run check:prod-env` until it reports no errors.
2. `npm ci && npm run build && npm run db:migrate && npm run db:seed && npm run admin:create-super -- --email … --name …`.
3. Set real membership plan prices in Admin → Super Admin → Membership Plans (the seed's prices are placeholders; re-seeding no longer overwrites your edits).
4. Put the app behind HTTPS and a reverse proxy; set `TRUST_PROXY_HOPS`.
5. Save Razorpay and/or PhonePe **test** credentials in Platform Settings → Payment gateway, press *Test connection*, point the vendor webhooks at the URLs shown there, make one test purchase, one refund. Then switch to live credentials.
6. Choose the OTP provider in Platform Settings; confirm a signup code arrives by e-mail or SMS.
7. Schedule the six jobs (`DEPLOYMENT_PRODUCTION.md` §6).
8. Configure the encrypted off-box backup and run a **restore verification** (`BACKUP_DR.md`).
9. Upload a photo (proves storage), delete a test account and recover it (proves the OTP path).

## 6. Verification summary (this phase)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` (real PostgreSQL) | **75 files / 716 tests passed, 0 failed** |
| `npm run build` | compiled successfully; 133 API routes, 46 pages |
| `npm run smoke:prod` (production build, fresh empty database, all migrations, seed, mock SMTP over STARTTLS) | **123/123** |
| `npm run smoke:gateway` (mock Razorpay, PhonePe, Fast2SMS, SMTP) | **52/52** |
| `npm run smoke:ui` / `smoke:ui-gateway` (Chromium) | **42/42** / **35/35** |
| `npm run smoke:b18` (HTTP, both OTP configurations) / `smoke:b18-ui` (Chromium: member, Super Admin, Staff Admin) | **114/114** / **42/42** |
| Clean export (unzip → `npm ci` → `tsc` → build → smoke) | see `EXPORT_VERIFICATION.txt` delivered beside the zip |

All of the above used local mocks for third parties. Nothing was verified against a real vendor.

## 7. What was not done, and why

See `B18_KNOWN_LIMITATIONS.md` and `PCP_KNOWN_LIMITATIONS.md`. In short: no real vendor call (no credentials), no admin MFA, CSP still allows inline scripts, auto-renew cannot charge a card, chat messages are retained after account anonymisation, controller-level rate limits are per-process (the shared policy limiter is exact), and the Razorpay popup / PhonePe hosted page were never rendered.

## 8. Security rules kept throughout

No real secrets, passwords, API keys, private keys or production credentials are in this export — only placeholders in `.env.example` / `.env.test.example`. No Git repository was initialised and nothing was pushed. No auth secret is held in frontend storage. API secrets are never exposed to frontend or mobile bundles.
