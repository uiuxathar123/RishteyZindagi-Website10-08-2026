# RishteyZindagi — Final Handover (B16) — ARCHIVED; superseded by ../FINAL_HANDOVER.md (Production Completion Phase). Some statements below (e.g. "no real provider exists", "52 tables", "96 routes") describe the state before that phase.

**One application:** frontend + backend + database + authentication + user flows + admin panel, running together locally from a clean checkout.
Everything below was verified against the real running application (real HTTP, real PostgreSQL). Where something is **not live**, it is labelled so — nothing is faked.

---

## 1. Project overview

RishteyZindagi.com is a premium Indian + NRI matrimonial platform. Members sign up (with OTP verification), build a profile with photos, set partner preferences, receive recommendations, send interests/likes, shortlist, block and report, chat once matched (membership required), and buy a membership. Staff run the platform from a separate admin panel with role-based permissions.

| Fact | Value |
|---|---|
| Repository layout | one Next.js project (`src/app` UI + `src/app/api/v1` API + `src/server` backend) |
| API routes | **96** (95 from B1–B15 + `GET /admin/me`) |
| Session-proxy handlers | 3 (`/bff/[...path]`, `/bff/dev/status`, `/bff/dev/otp-code`) |
| UI pages | 40 |
| Migrations / tables | 11 / 52 (B16 added none) |
| Test files / tests | 53 / 476 |
| Phases | B1–B15 frozen · B16 final integration (this document) |

## 2. Architecture

```
Browser ─► /bff/*   same-origin session proxy (src/app/bff/[...path]/route.ts)
              │      • httpOnly cookies: rz_session (member, SameSite=Lax), rz_admin_session (admin, SameSite=Strict), rz_device_id
              │      • token stripped from JSON responses and kept only in the cookie
              │      • CSRF: non-GET requests must be same-origin (Origin / Sec-Fetch-Site) else 403
              │      • member cookie is attached only to non-admin paths; admin cookie only to /bff/admin/* and /bff/as-admin/*
              ▼
        /api/v1/*   route.ts → controller → service → repository → PostgreSQL (Drizzle ORM)
                    envelope { success, data, message } | { success:false, error:{ code, message, details } }
```

Why a proxy: the backend (frozen) authenticates with `Authorization: Bearer <opaque token>`. Keeping that token in `localStorage` would expose it to any injected script, so the browser never holds it; the proxy attaches it server-side. Native clients (a future Android app) call `/api/v1` with a Bearer token directly, unchanged.

## 3. Frontend

* **Shells:** `src/app/(marketing)` public site · `src/app/dashboard` member area · `src/app/admin` staff panel (`/admin/login` + guarded `(panel)` group). Each shell has its own chrome; the admin panel never imports the public header or member dashboard.
* **API layer:** `src/lib/api/` — `client.ts` (`api`, `adminApi`, `asAdminApi`), `errors.ts` (`ApiError` with kinds validation/unauthorized/forbidden/not_found/conflict/rate_limited/unavailable/server/network/aborted), `hooks.ts` (`useAsync` with abort-on-unmount, `useAction`), `types.ts` (DTOs), `server.ts` (server-component session reads), `lookups.ts` (reference data).
* **States:** every connected view handles loading (skeleton), empty, error (all kinds, with retry), validation (mapped to fields), conflict, rate-limited, unavailable, network failure. A 401 on a signed-in call sends the person to `/login?expired=1&next=…` (or `/admin/login`).
* **Route guards:** `/dashboard/*` and `/admin/*` are guarded in server layouts (session read from the cookie before anything renders); the API re-authorises every call independently.
* **Responsive:** verified at 375 / 768 / 1024 / 1440 px on the production build (§26).

## 4. Backend

Layered `route → controller → service → repository`. Modules under `src/server/modules`: auth, users, otp, profiles (+photos, completion, reference), preferences, search, recommendations, interactions, chat, notifications, devices, memberships, payments (+gateways), invoices, reports, warnings, admin, audit, behaviour-events, storage, health. Rate limits are in-memory per instance, keyed by client IP. All B1–B15 behaviour is unchanged; B16's additive backend changes are listed in `B16_AUDIT.md` §12.1.

## 5. Admin panel

`/admin/login` → separate admin session. Pages: Overview (live counts, nothing estimated), Users (search/filter/detail/verify/lift suspension/warnings), Profile Approvals, Reports (+ category management), Settings (own identity and effective permissions; Super Admin: OTP delivery, matching weights, payment gateways), Revenue (payments, invoices, memberships, manual verification, invoice cancel/regenerate), Audit Log, Staff & Roles (**honestly “not available yet”** — no API exists). The sidebar and pages come from `GET /admin/me` (role + permission keys); the API enforces each permission regardless.

## 6. Authentication

| Flow | Endpoint(s) | Notes |
|---|---|---|
| Signup | `register` → `verify-signup-otp` → `set-password` | no account exists until the password is set; session is created at the last step; the profile (gender, DOB, optional religion/community) is created right after |
| Login | `login` | on an **unknown device** the API answers `deviceVerificationRequired` and an OTP step follows (`verify-device`); a known device (`rz_device_id` cookie) gets a session directly |
| OTP login | `request-login-otp` → `verify-login-otp` | |
| Forgot / reset | `forgot-password` → `reset-password` | same reply whether or not the account exists; reset **revokes every session** |
| Logout / logout-all | `logout`, `logout-all` | session revoked server-side, cookie cleared; “log out of all devices” revokes other devices |
| Expired / revoked session | any 401 | redirected to login with `next` preserved |
| Admin login | `POST /admin/login` | separate cookie, separate identity; a member token is rejected on admin routes and vice-versa |

Tokens are opaque random values hashed (HMAC with `AUTH_SECRET`) in `device_sessions`; passwords are bcrypt hashes.

## 7. OTP

Providers: SMS, WhatsApp, E-mail (scaffolds that refuse honestly) and a dev provider. Exactly **one** method is active (`otp_configs.active_method`), changed by a Super Admin at **Platform Settings → One-time passwords** (`GET/PATCH /admin/otp/config`). Dev provider: non-production only and only when `otp_configs.dev_mode = true`; codes live in process memory (anchored on `globalThis`), are never stored, logged or returned by the API; the *only* reader is the dev route behind the “Show my verification code” helper (§22).

## 8. Database

PostgreSQL 16, 52 tables, 11 SQL migrations in `drizzle/` applied by the idempotent runner `npm run db:migrate`. Seed (`npm run db:seed`) loads roles, 11 permissions, reference data (incl. 34 community groups, added in B16 as data only), categories, 5 gateway rows, 8 plans, and — only in development with `SEED_DEV_SUPER_ADMIN=true` — one dev Super Admin.

## 9. API structure

`/api/v1/` — auth (11) · users · profiles (me, completion, photos ×5, public view, photo file) · profiles/me/partner-preferences · profiles/me/recommendations · search/profiles · interactions (interests, likes, shortlist, matches, blocks) · chats (+messages, read, unread-count) · notifications (+read, read-all, unread-count) · devices/push-tokens · membership-plans · memberships (+checkout, me, history, renew, auto-renew) · payments (+verify) · invoices (+download, resend) · reports (+categories) · warnings · reference/profile-options · health · admin/* (login, me, ping, dashboard, users, profiles/verify, reports, report-categories, warning-categories, otp/config, matching/weights, payment-gateways, payments, invoices, memberships, audit-logs). Full detail and the B16 corrections: `API_REFERENCE.md`.

## 10. RBAC

Roles `SUPER_ADMIN`, `STAFF_ADMIN`. Eleven permission keys:

| Permission | SUPER_ADMIN | STAFF_ADMIN (default) |
|---|---|---|
| `admin.ping` | ✔ | ✔ |
| `users.view` (users, user detail, dashboard stats) | ✔ | ✔ |
| `profiles.verify` | ✔ | ✔ |
| `reports.resolve` | ✔ | ✔ |
| `audit.view` | ✔ | ✘ |
| `payments.review` (payments, invoices, memberships admin) | ✔ | ✘ |
| `platform.settings.manage` (OTP config, matching weights, gateways) | ✔ | ✘ |
| `reports.categories.manage` | ✔ | ✘ |
| `users.suspend` / `warnings.issue` | ✔ | ✘ |
| `staff.manage` | ✔ | ✘ |

Enforced in the service layer by `requirePermission`; the UI merely mirrors it from `/admin/me`. Verified: Staff Admin receives **403** on audit log, OTP config, matching weights, gateways, payments, invoices, memberships, report-category creation, lift-suspension and warnings; members and anonymous callers receive **401**.

## 11. User flows (all verified)

1. **Anonymous:** home → search (limited, name-less cards) → Login/Sign-up CTA.
2. **Signup:** details → OTP → password → profile created → dashboard (completion shown from the backend).
3. **Login → dashboard → logout**, incl. new-device verification.
4. **Profile:** edit every section; photos upload/primary/reorder/delete; partner preferences; completion % and missing fields come only from the backend; “visible” only when complete + photo.
5. **Discover:** recommendations (primary + “you may also like”), search with filters/pagination, member page.
6. **Interact:** interest (needs an active membership), accept/decline/withdraw, like/unlike, shortlist, block/unblock, report. Real server messages on failure (e.g. “You are already matched with this user.”).
7. **Match → chat:** mutual interest creates a match; chat needs the match **and** an active membership; expiry blocks sending (403) while history stays readable.
8. **Membership:** plans from the API → checkout → verify → active membership + invoice (PDF download) + history.
9. **Notifications:** list, unread count, mark one/all read (all created by the backend).
10. **Settings:** password change via emailed code, logout, log out of all devices, warnings from the team, blocked members.

## 12. Admin flows (all verified)

Super Admin: login → overview → users (search, detail) → verify a profile (member sees the status) → reports → OTP config (one active method) → matching weights (sum = 100, validated by the backend) → gateways → revenue → audit log (records the actions). Staff Admin: login → users, profile approvals, reports, own settings → Super-only screens show “Super Admin only” and every Super-only API call returns 403.

## 13. Local installation

See **`LOCAL_SETUP.md`** (step by step, Windows/macOS/Linux).

## 14. Environment variables

Full table in `LOCAL_SETUP.md` §4 and the commented `.env.example` / `.env.test.example`. Required: `DATABASE_URL`, `AUTH_SECRET`. New in B16 (both optional, non-secret): `INTERNAL_API_ORIGIN`, `NEXT_PUBLIC_SUPPORT_EMAIL`.

## 15. Database setup

`CREATE DATABASE rishteyzindagi_dev; CREATE DATABASE rishteyzindagi_test;` then migrate + seed **both** (the test suite needs the seed data).

## 16–19. Commands

| Purpose | Command |
|---|---|
| Migrate | `npm run db:migrate` (override `DATABASE_URL` for the test DB) |
| Seed | `npm run db:seed` |
| Tests | `npm test` (~8–12 min) |
| Type-check | `npx tsc --noEmit` |
| Build / start | `npm run build` / `npm start` |
| Production env pre-flight | `npm run check:prod-env` |

## 20. Production deployment steps

Follow `DEPLOYMENT.md` and `B16_PRODUCTION_INFRASTRUCTURE.md` (12 “manual decision required” items: hosting, domain/DNS, TLS, secrets manager/KMS, CI/CD, monitoring, backups off-box, object storage, …). In addition for this integration:

1. Terminate TLS in front of the app and serve **only** over HTTPS — when `NODE_ENV=production` the session cookies are marked `Secure`, so they are not sent over plain HTTP (browsers other than Chrome/Firefox may not even accept them on `http://localhost`; test a local production build in Chrome or Firefox).
2. Run **one** instance per rate-limit/OTP-memory domain, or replace the in-memory limiter first (see §24).
3. Set `NODE_ENV=production`, a strong `AUTH_SECRET`, `DATABASE_URL`, `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`; run `npm run check:prod-env`; run `npm run db:migrate && npm run db:seed` (seed **without** `SEED_DEV_SUPER_ADMIN`); create the first real Super Admin by SQL (see `LOCAL_SETUP.md` §9 — use the SUPER_ADMIN role).
4. Do **not** go live until sections 21–23 below are configured.

## 21. Payment configuration — NOT CONFIGURED

| | |
|---|---|
| **State** | No real gateway SDK is implemented (Razorpay, Cashfree, PayU, PhonePe, Paytm are scaffolds). Outside production the built-in **dev gateway** completes checkout; the checkout screen says so in a visible “development build” notice. In production checkout reports that no payment gateway is configured — it never pretends. |
| **Required** | A real provider class per gateway (create order, verify, webhook) + merchant credentials. The B16.12 payment go-live gate in `B16_PRODUCTION_INFRASTRUCTURE.md` is **not met** (expected pre-launch). |
| **Where to configure** | Credentials: Admin → Platform Settings → Payment gateways (stored AES-256-GCM encrypted; needs `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`). Code: `src/server/modules/payments/providers/*.provider.ts`. |
| **How to verify** | Admin → Platform Settings → gateway → **Test connection**; then a real sandbox checkout → `POST /payments/{id}/verify`; compare in Admin → Revenue. There is no webhook (pull-based verification only). |
| **Also** | GST is a 18 % placeholder (`GST_RATE_PERCENT`) — confirm with an accountant. Auto-renew saves a preference only; no automatic charging runs. |

## 22. OTP provider configuration — NOT CONFIGURED

| | |
|---|---|
| **State** | SMS/WhatsApp/e-mail providers are scaffolds whose `send()` refuses (“service unavailable”). Local development uses dev mode (`LOCAL_SETUP.md` §8). In production **new signups, OTP login, new-device verification and password reset cannot work** until a provider exists (password login on a known device keeps working). |
| **Required** | Implement `send()` in the chosen provider (`src/server/modules/otp/providers/`), set `EMAIL_/SMS_/WHATSAPP_PROVIDER` + `*_API_KEY`, then choose the single active method in Admin → Platform Settings. |
| **How to verify** | Sign up with a real address and receive the code; `GET /api/v1/health/ready` lists each provider as configured/not_configured. |

## 23. Storage configuration — LOCAL DISK ONLY

Photos and invoice PDFs are stored in `.storage-local/` (git-ignored) and served only through authenticated routes. No cloud provider is implemented; any other `STORAGE_PROVIDER` value makes uploads fail on purpose. For production implement a provider in `src/server/modules/storage/` and back the volume up (there is no independent backup of this folder). Verify: upload a photo, restart the server, confirm it still loads.

## 24. Known limitations

* **No real OTP / payment / push / cloud-storage vendors** (§21–§23).
* **Chat is polling**: the open conversation and the conversation list refresh every 10 s and the sidebar unread badge every 60 s. There is no WebSocket/SSE infrastructure; the screen says “no live push yet”.
* **In-memory rate limiting and dev OTP/payment stores** — correct for one instance only; a restart clears them.
* **No staff-management API** — the Staff & Roles screen is informational; staff accounts are created by SQL.
* **Not supported by the backend, therefore not offered:** change e-mail/mobile, account deactivation, privacy/notification preference toggles, “profile views”, feature flags, per-member photo moderation (the moderation column is dormant), refund totals, “active today”/“signups this week” dashboard metrics (shown as “not tracked”).
* **Recommendation cards** for an already-matched member still show “Send interest” until clicked; the server then answers 409 and the card switches to “Message”.
* **Static marketing content:** blog, FAQ and the *sample* success stories (stock photos, labelled as samples). The “celebrating 10 years / thousands of matches” wording on Home/About is owner-supplied marketing copy that nothing in the product verifies — the business must confirm or edit it.
* `GET /profiles/{id}` is called per list row to link counterparts (bounded by page size).
* The payment go-live gate and 12 production decisions of `B16_PRODUCTION_INFRASTRUCTURE.md` remain open.
* Mobile number verification does not exist (only e-mail OTP is exercised); `mobileVerified` stays false.

## 25. Remaining production configuration

OTP vendor · payment gateway SDK + credentials · cloud object storage (+ off-box backups) · hosting, TLS, domain/DNS · secrets manager/KMS · shared rate-limit/OTP store if scaling out · monitoring/alerting · CI/CD · real Super Admin account · legal review of Terms/Privacy/Refund text and GST · replace sample success stories with real ones · set `NEXT_PUBLIC_SUPPORT_EMAIL`.

## 26. Exact test results

Run on the final code (after the last code change, `next.config.js` security headers), real PostgreSQL 16 test database:

| Check | Result |
|---|---|
| `npm test` | **53 files / 476 tests passed, 0 failed** (duration 618 s). 466 pre-existing + 10 new in `tests/b16-integration.test.ts` |
| `npx tsc --noEmit` | exit 0, no errors |
| HTTP smoke (dev server, real PostgreSQL) | see `B16_FINAL_REPORT.md` §3 |
| Production-build probe | signup/login-OTP 503, dev reveal 404, checkout fails closed, security headers present on pages and API |
| Responsive sweep (production build) | **184/184** — public 76, member 40, super admin 40, staff admin 28 (375/768/1024/1440 px) |

The same commands were repeated inside the clean export: results in `B16_FINAL_REPORT.md` §6 and `EXPORT_VERIFICATION.txt` (delivered beside the ZIP).

## 27. Exact build result

`npm run build` (Next.js 14.2.35) on the final code: **Compiled successfully**, type/lint check passed, 48 static pages generated, **96 API routes**, 3 `/bff` handlers, 40 UI pages, middleware 26.8 kB. First-load JS shared by all pages: 87.3 kB. `npm start` serves it; `/api/v1/health` → 200 `{"status":"ok","database":"connected"}`.

## 28. Final file manifest

Export folder `RishteyZindagi_FINAL_HANDOVER/` (ZIP: `RishteyZindagi_FINAL_HANDOVER.zip`). **Excluded on purpose:** `.env`, `.env.test` and any other real env file, secrets/API keys/passwords, `node_modules/`, `.next/`, `.storage-local/`, logs, temp databases, `tsconfig.tsbuildinfo`, OS/editor files. `public/` does not exist in this project (no static public assets: fonts are bundled in `src/app/fonts/`, icon is `src/app/icon.svg`).

| Path | Contents | Files |
|---|---|---|
| `src/app/` | UI pages + `api/v1/**` route handlers + `bff/**` session proxy | 161 |
| `src/components/` | UI components (session, forms, auth, dashboard, admin, membership, profile, search, home, layout) | 106 |
| `src/lib/` | typed API client, BFF config, helpers | 10 |
| `src/server/` | backend: modules, db (schema, client, seed, reference data), middleware, config, lib | 148 |
| `src/data/`, `src/services/` | static content (blog, FAQ, sample testimonials) and its service | 5 |
| `drizzle/` | all SQL migrations (11) + journal | 23 |
| `tests/` | Vitest suite (53 test files) + helpers | 56 |
| `scripts/` | backup, restore, deploy, production-env check, perf seed | 5 |
| `docs/phase-status/` | per-phase status documents (B1–B16b + frontend) | 18 |

Root files: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.js`, `next-env.d.ts`, `tailwind.config.ts`, `postcss.config.js`, `drizzle.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.env.test.example`, `scripts-smoke-otp.ts` (B-phase OTP smoke helper, unchanged).

Documentation at the root: `API_REFERENCE.md`, `B15_FINAL_REPORT.md`, `B15_KNOWN_LIMITATIONS.md`, `B15_RELEASE_CHECKLIST.md`, `B15_RELEASE_READINESS_MATRIX.md`, `B16_AUDIT.md`, `B16_FINAL_REPORT.md`, `B16_PRODUCTION_INFRASTRUCTURE.md`, `B16_RELEASE_READINESS.md`, `BACKEND.md`, `BACKUP_DR.md`, `DEPLOYMENT.md`, `FINAL_HANDOVER.md`, `LOCAL_SETUP.md`, `PERFORMANCE_REPORT.md`, `QA_TRACEABILITY_MATRIX.md`, `README.md`, `SECURITY_RELEASE_CHECKLIST.md`.

Migrations: `0000_nosy_polaris.sql`, `0001_b2_auth_otp.sql`, `0002_b3_profile_photos.sql`, `0003_b4_partner_preferences_search.sql`, `0004_b5_gap_fixes.sql`, `0005_b6_social_interaction.sql`, `0006_b7_chat_notifications.sql`, `0007_b8_membership_payment.sql`, `0008_b10_security_hardening.sql`, `0009_b11_push_tokens.sql`, `0010_b13_performance_indexes.sql`.

Total files in the export: 564.
