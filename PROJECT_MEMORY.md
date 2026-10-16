# Project Memory — RishteyZindagi.com

The one page to read first. It points to the detailed documents and records the facts and rules every session should know. Updated 2026-10-17 by a read-only audit (no code changed).

## What it is

A premium Indian + NRI matrimonial platform. One Next.js 14 (App Router) + TypeScript + Tailwind application holds the public site, member dashboard, admin panel and the full REST backend (`/api/v1`) on PostgreSQL 16 with Drizzle ORM. Browsers go through a same-origin session proxy (`/bff/*`, httpOnly cookies); other clients (a future Android app) call `/api/v1` with a bearer token.

## Key facts (verified 2026-10-17)

| Fact | Value |
|---|---|
| Repository | `https://github.com/uiuxathar123/RishteyZindagi-Website10-08-2026.git`, branch `main` (14 commits, head `5778152`, 2026-10-13) |
| Tracked files | 847 |
| API | 167 route files, 203 handlers, all wrapped in `withErrorHandling` |
| UI pages | 51 (`page.tsx`): 21 public, 11 member, 19 admin |
| Database | 66 tables, 18 enums, 19 migrations (`drizzle/0000`–`0018`) |
| Server modules | 27 under `src/server/modules/` |
| Background jobs | 8; must be scheduled externally (cron or `POST /api/v1/internal/jobs/<name>` with `CRON_SECRET`) |
| Tests | 91 Vitest files. Last full run 2026-10-11: 794 passed, 20 skipped, 0 failed. **Nine files changed after that run** (see `docs/QA_BASELINE.md`). |
| Third parties | Razorpay, PhonePe, Fast2SMS, SMTP, FCM, WhatsApp, S3: implemented and mock-tested only, **never called live** |
| Not in repo | CI, Docker, mobile app |

## Rules for every session

1. Never open, print or commit `.env`, `.env.test` or any `.env.*` other than the two `*.example` templates.
2. The backend is the authority: every permission, ownership and membership rule is enforced in services, not the UI.
3. Follow the existing pattern: `route.ts` (thin) → controller (zod + `authenticate`) → service (rules, `requirePermission`, `record()` audit) → repository (Drizzle).
4. Migrations are additive, new files in `drizzle/`. Never edit an applied migration.
5. Return **403, not 401,** for a failed re-check inside a valid session (wrong current password, wrong code). A 401 makes the BFF sign the user out. (`contact-change` broke this rule until the D-1 fix of 2026-10-18.)
6. Use `getClientIp()` for client IPs, `getEnv()` for configuration, `ok()`/`AppError` subclasses for responses.
7. Don't claim something works live or performs well without evidence; this project's documents separate "mock-verified" from "verified".
8. Owner approval before implementation, commits or pushes.

## Where to look

| Need | Document |
|---|---|
| Continue the audit / start a new session | `docs/NEXT_SESSION_HANDOVER.md` |
| Which files were read | `docs/FILE_AUDIT_CHECKLIST.md` |
| Architecture map | `docs/PROJECT_ARCHITECTURE.md` (request traces: `docs/FRONTEND_BACKEND_ARCHITECTURE.md`) |
| What features exist | `docs/FEATURE_INVENTORY.md` |
| Test evidence and gaps | `docs/QA_BASELINE.md` (older matrix: `QA_TRACEABILITY_MATRIX.md`) |
| Performance plan | `docs/PERFORMANCE_ROADMAP.md` (older measurements: `PERFORMANCE_REPORT.md`) |
| Android readiness | `docs/MOBILE_APP_ROADMAP.md` |
| Assisted matchmaking proposal | `docs/PERSONAL_MATCHMAKING_SPEC.md` |
| Open decisions, bugs, changelog | `docs/DECISIONS_AND_CHANGELOG.md` |
| Local setup, deploy, vendors, backups | `LOCAL_SETUP.md`, `DEPLOYMENT_PRODUCTION.md`, `PRODUCTION_ENV_REFERENCE.md`, `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md`, `PROVIDER_TEST_SETUP.md`, `BACKUP_DR.md` |
| Phase history and known limitations | `BACKEND.md`, `docs/phase-status/`, `B15`–`B19` and `PCP_*` reports |

## Audit status

**Not complete.** 108 files read in full, 73 outlined, 166 API routes pattern-verified, 469 still pending (mostly UI components, tests and older documents). Next steps are in `docs/NEXT_SESSION_HANDOVER.md` §4.

## Top open items (details in `docs/DECISIONS_AND_CHANGELOG.md`)

* D-1: wrong password during e-mail/mobile change signed the member out. Fixed 2026-10-18, pending commit.
* D-2: admin MFA off by default; admin sessions last 30 days.
* D-3: interests require a paid membership in code, but B18 docs say free.
* D-5 / D-6: invoices not GST-ready; payment SUCCESS is committed before membership activation.
* D-7: SMS OTP only for Indian numbers; most NRIs pay in INR.
