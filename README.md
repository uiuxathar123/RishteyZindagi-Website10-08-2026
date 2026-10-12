# RishteyZindagi.com

Premium Indian + NRI matrimonial platform — **one Next.js 14 (App Router) + TypeScript + Tailwind project** containing the public website, the member dashboard, the admin panel and the complete REST backend (PostgreSQL 16 + Drizzle ORM).

**Status:** backend phases B1–B15 and B16a/b frozen; the **Production Completion Phase (PCP)** added real Razorpay/PhonePe payments, Email/Fast2SMS OTP, account deletion + recovery, moderation, staff management, S3 storage, shared rate limiting, scheduled jobs and encrypted backups. Everything is verified against local mocks; **no real third-party vendor has been called** (REQUIRES EXTERNAL CREDENTIALS). See `PCP_FINAL_REPORT.md`, `PCP_RELEASE_READINESS_MATRIX.md` and `FINAL_HANDOVER.md`.

## Start here

| I want to… | Read |
|---|---|
| Run it on my machine | **`LOCAL_SETUP.md`** |
| Understand everything / hand it over | `FINAL_HANDOVER.md` |
| See what was verified and what is not live | `PCP_RELEASE_READINESS_MATRIX.md`, `PCP_FINAL_REPORT.md`, `PCP_KNOWN_LIMITATIONS.md` |
| Audit before/after | `PRODUCTION_COMPLETION_AUDIT.md` |
| Know how every screen maps to an API | `B16_AUDIT.md` |
| Call the API | `API_REFERENCE.md` (the HTTP methods in the route files are the authority; see its B16 addendum) |
| B18 additions (OTP policy, plans, communities, privacy, permissions) | `B18_FINAL_REPORT.md`, `B18_PERMISSION_MATRIX.md`, `B18_KNOWN_LIMITATIONS.md`, `API_REFERENCE.md` §21 |
| B19 additions (site controls, admin MFA, manual approval, contact/stories, groups, live chat, digest) | `B19_FINAL_REPORT.md`, `B19_KNOWN_LIMITATIONS.md`, `B19_RELEASE_READINESS_MATRIX.md`, `API_REFERENCE.md` §22 |
| Backend design, per phase | `BACKEND.md`, `docs/phase-status/` |
| Deploy | **`DEPLOYMENT_PRODUCTION.md`**, `PRODUCTION_ENV_REFERENCE.md` |
| Payments / OTP setup | `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md` |
| Back up / restore | `BACKUP_DR.md` (addendum first) |
| Older deployment notes (B-phase) | `DEPLOYMENT.md`, `B16_PRODUCTION_INFRASTRUCTURE.md` |

## Quick start

```bash
npm install
cp .env.example .env && cp .env.test.example .env.test   # then fill in the placeholders
npm run db:migrate && npm run db:seed
npm run dev                                              # http://localhost:3000
```

## How the pieces fit

```
Browser ──► /bff/*  (same-origin session proxy, httpOnly cookies, CSRF origin check)
                │            rz_session        → member routes only
                │            rz_admin_session  → /bff/admin/* and /bff/as-admin/* only
                ▼
          /api/v1/*  route.ts → controller → service → repository → PostgreSQL (Drizzle)
```

* **Three separate shells:** `src/app/(marketing)/` (public site), `src/app/dashboard/` (members), `src/app/admin/` (staff). Member and admin sessions are different cookies and different server-side identities; neither is accepted by the other's routes.
* **One API client** (`src/lib/api/`) used by every screen: typed errors (validation / unauthorized / forbidden / not found / conflict / rate limited / unavailable / server / network), abort-on-unmount, loading/empty/error states.
* **Backend is authoritative.** The UI hides what a role cannot do, but every action is enforced again by the API (RBAC, ownership, membership, blocks).
* **No fake data where an API exists.** Static content that has no API (blog articles, FAQ, *sample* success stories — labelled as samples) lives in `src/data/`.

## Tech

Next.js 14.2 · React 18 · TypeScript 5 · Tailwind CSS · PostgreSQL 16 · Drizzle ORM · zod 4 · bcryptjs · pdfkit · Vitest (real PostgreSQL test database).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` / `db:seed` | Migrations (19 → 66 tables) / reference data |
| `npm run admin:create-super -- --email … --name …` | First Super Admin |
| `npm run job -- <name>` | Scheduled jobs (`--list` shows them) |
| `npm run smoke:prod` / `smoke:gateway` / `smoke:b18` | Real-HTTP smoke tests against a production build |
| `npm run smoke:ui` / `smoke:ui-gateway` / `smoke:b18-ui` | Headless-browser checks (Playwright + Chromium needed) |
| `npm test` | Vitest, 66 files, ~15–20 min on 2 cores, needs the migrated + seeded **test** DB |
| `npx tsc --noEmit` | Type-check |
| `npm run check:prod-env` | Production-readiness check of your env |

## Not verified live (nothing is faked)

Razorpay, PhonePe, Fast2SMS, SMTP, WhatsApp Cloud API, FCM, S3-compatible storage and off-box backup are implemented and tested against protocol mocks only. They work the moment you supply real credentials and complete the go-live checklists in `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md` and `DEPLOYMENT_PRODUCTION.md`; until then they fail closed with an honest message. WebSocket chat does not exist (the chat screen polls). Auto-renewal cannot charge a card unattended. Full list: `PCP_KNOWN_LIMITATIONS.md`.


**Provider setup (Razorpay test mode, SMTP e-mail OTP):** see `PROVIDER_TEST_SETUP.md`.

**Git handover:** see `GIT_HANDOVER.md` (first commit, pre-commit secret scan: `npm run hooks:install`, `npm run scan:secrets`).
