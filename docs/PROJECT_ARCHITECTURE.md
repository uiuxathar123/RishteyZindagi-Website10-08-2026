# Project Architecture

Verified from source on 2026-10-17 (`main` at `5778152`; the later commit `4262de9` changes only the contact-change status codes and does not affect this map). Request-level flows (dashboard stats, login, protected layouts) are already traced in `docs/FRONTEND_BACKEND_ARCHITECTURE.md`; this document is the wider map and links to it rather than repeating it.

Evidence: claims come from files marked READ in `docs/FILE_AUDIT_CHECKLIST.md`, unless marked *(outlined)*. Counts (pages, routes, handlers, tables, modules, jobs, tests) come from scripted counts over `git ls-files` and the schema, re-checked on 2026-10-17. §5 lists the evidence level per module.

## 1. Shape

One deployable **Next.js 14.2 App Router** application (TypeScript 5, React 18, Tailwind 3). It contains:

* the public website, member dashboard and admin panel (React pages and components),
* the complete REST backend under `/api/v1` (Next.js route handlers),
* a same-origin session proxy under `/bff/*`,
* CLI scripts for migrations, seeding, jobs, backups and smoke tests.

Data lives in **PostgreSQL** (version 16 per `README.md`; the code itself only needs 13 or later, because migrations from `0012` use the built-in `gen_random_uuid()`), accessed through **Drizzle ORM 0.45** over `pg` (one pool, `max: 10`, in `src/server/db/client.ts`). There is no Redis, queue, WebSocket server or separate worker process.

```text
Browser ──► Next.js pages (src/app)                     Android / other clients
              │  client components call src/lib/api       │  Authorization: Bearer <token>
              ▼                                            │  X-Device-Id: <stable id>
         /bff/[...path]  (same-origin proxy)               │
              │  reads httpOnly cookie, adds Bearer,       │
              │  CSRF Origin/Sec-Fetch-Site check          │
              │  loopback fetch → 127.0.0.1:<port>         │
              ▼                                            ▼
         src/middleware.ts  (/api/* only: CORS + security headers, OPTIONS → 204)
              ▼
         src/app/api/v1/**/route.ts   167 files, all wrapped in withErrorHandling
              ▼
         withErrorHandling  → shared rate-limit policy → maintenance gate → handler
              ▼
         controller (zod validation, authenticate(), in-process rate limits)
              ▼
         service (business rules, requirePermission / ownership checks, audit, notify)
              ▼
         repository (Drizzle queries)  ──► PostgreSQL
```

## 2. Folder map

| Path | Role |
|---|---|
| `src/app/(marketing)/` | Public site: home, search, about, FAQ, blog, contact, safety, policies, login, signup, forgot password, account recovery, membership, checkout, payment return. 21 pages. |
| `src/app/dashboard/` | Member area: overview, profile, matches, interests, shortlist, messages, groups, notifications, membership, settings, member profile view. 11 pages + layout. |
| `src/app/admin/` | Admin login page plus 18 `(panel)` pages: overview, users, profiles, reports, visibility queue, account deletions, inbox, stories, groups, settings; `super/`: overview, staff, revenue, membership plans, communities, audit log, security events, settings. 19 pages + layouts. |
| `src/app/api/v1/` | 167 route adapters, 203 HTTP handlers (89 GET, 75 POST, 28 PATCH, 9 DELETE, 2 PUT). Largest families: admin (72), auth (14), profiles (11), interactions (9). |
| `src/app/bff/[...path]/route.ts` | Session proxy. |
| `src/components/` | UI by area: `admin/`, `dashboard/`, `auth/`, `home/`, `membership/`, `profile/`, `search/`, `ui/`, `layout/`. 98 files under `src/app` and `src/components` are client components (`"use client"`), out of 191 non-API `.ts`/`.tsx` files there (131 in `src/components`). *(counted; components mostly PENDING)* |
| `src/lib/api/` | The single browser API client (`client.ts`), typed errors, `useAsync`/`useAction` hooks, cached reference lookups, server-side session helpers (`server.ts`). |
| `src/lib/bff/config.ts` | Cookie names, public auth paths, internal API origin. |
| `src/data/`, `src/services/` | Static marketing content (blog posts, FAQs, sample testimonials) with no backend API. |
| `src/server/config/` | `env.ts` (zod-validated environment), production readiness checks. |
| `src/server/db/` | `schema.ts` (66 tables, 18 enums), `client.ts`, `migrate.ts`, `seed.ts`, reference data. |
| `src/server/lib/` | Errors, response envelope, logger with redaction, password (bcryptjs cost 12), session token hashing, OTP hashing, AES-256-GCM for gateway credentials, SMTP mailer, shared rate-limit store, SigV4 signer, client IP. |
| `src/server/middleware/` | `withErrorHandling`, `authenticate`, `rbac`, rate-limit policy, legacy in-process limiter, maintenance gate. |
| `src/server/modules/` | 27 feature modules (see §5). |
| `src/server/jobs/` | Job registry, runner (advisory lock), 8 job definitions. |
| `drizzle/` | 19 ordered SQL migrations + drizzle-kit metadata. |
| `scripts/` | Operations CLIs, backup/restore shell scripts, smoke tests, secret scanner, git hook. |
| `tests/` | 91 Vitest files + 10 helpers, run against a real PostgreSQL test database. |

## 3. Cross-cutting rules (verified)

* **Response envelope:** success `{ success: true, data, message }`; error `{ success: false, error: { code, message, details? } }` (`src/server/lib/response.ts`). Error classes map to 400/401/403/404/409/429/500/503 (`src/server/lib/errors.ts`).
* **Validation:** request bodies go through `parseJsonBody(req, zodSchema)`; failures return field-level `details`.
* **Logging:** one JSON line per request (request id, method, endpoint, status, duration, user id). Keys such as password, otp, token, secret and card number are redacted at any depth (`src/server/lib/logger.ts`).
* **Audit:** `audit.record()` writes `audit_logs` for auth, admin, payment, privacy and moderation actions. It is best-effort and never fails the main action.
* **Environment:** read only through `getEnv()`, except `src/middleware.ts` (Edge) which reads `ALLOWED_ORIGINS` directly.

## 4. Identity, sessions and permissions

| Concern | Implementation |
|---|---|
| Identities | Members in `users`; staff in `admin_users`. Separate tables, separate login endpoints, never interchangeable. |
| Session token | 32 random bytes (hex), returned once. Only `sha256(AUTH_SECRET + ":" + token)` is stored in `device_sessions`. TTL `SESSION_TTL_HOURS` (default 720 h), the same for members and admins. |
| Browser transport | BFF moves the token into an httpOnly cookie: `rz_session` (SameSite Lax) for members, `rz_admin_session` (SameSite Strict) for admins, plus a non-secret `rz_device_id`. `/bff/admin/*` and `/bff/as-admin/*` only ever use the admin cookie. Any 401 on an authenticated call clears the cookie. |
| Non-browser transport | `Authorization: Bearer <token>` directly to `/api/v1`. Covered by `tests/mobile-integration.test.ts`. |
| Authentication | `authenticate()` looks up the hashed token, checks revoked/expired, requires the account to be `ACTIVE`, updates `last_seen_at`, and (throttled) `users.last_active_at`. |
| New-device check | Member password login from a device id never seen for that user requires a NEW_DEVICE OTP, unless the Super Admin policy turns it off. |
| Admin MFA | Optional e-mail OTP after the password. Off by default. |
| RBAC | Roles `SUPER_ADMIN` and `STAFF_ADMIN` (plus any role a Super Admin creates). 18 permission keys (seeded in `src/server/db/seed.ts`). `requirePermission()` resolves role → permissions from the database on every call (no cache) and blocks accounts that must change a temporary password. Some Super Admin settings also require the `SUPER_ADMIN` role. |
| Staff defaults | `STAFF_ADMIN` gets `admin.ping`, `users.view`, `profiles.verify`, `reports.resolve`. Everything else is Super-Admin-only unless granted. |

Permission → module map (from a code search):

| Permission | Used in |
|---|---|
| `users.view` | admin dashboard + trends, admin users, account deletions list, moderation view |
| `users.suspend` / `users.ban` | moderation, report auto-suspension lift |
| `profiles.verify` / `profiles.approve` | verification badge / manual approval queue |
| `reports.resolve`, `reports.categories.manage`, `warnings.issue` | reports, report categories, warnings |
| `staff.manage` | staff and roles (role creation and permission edits also need `SUPER_ADMIN`) |
| `platform.settings.manage` | OTP config/provider, payment gateways and credentials, platform settings, matching weights |
| `payments.review` | payments admin, manual activation, refunds, invoices admin, memberships admin, reconcile now |
| `audit.view` | audit logs, security events (+ `/admin/security-events/export` route) |
| `plans.manage`, `communities.manage`, `support.manage`, `content.manage`, `groups.manage` | plans, communities, contact inbox/support contact, success stories, community groups |

## 5. Server modules

| Module | Responsibility | Evidence |
|---|---|---|
| `auth` | Sign-up (register → OTP → ticket → set password), password login with new-device step, OTP login, forgot/reset password, logout, logout-all | READ |
| `otp` | Code generation/hash/verify, cooldowns, attempt limits, tickets, providers (SMTP e-mail, Fast2SMS SMS, dev, WhatsApp scaffold), admin config and provider switch | READ |
| `account` | Deletion with 30-day recovery, finalisation, contact change, privacy settings, notification preferences, session management | READ |
| `users` | `/users/me`, safe DTO | READ |
| `admin` | Admin login/MFA, `/admin/me`, dashboard, users, invoices, memberships, plans, communities, audit logs, security events, reconcile | admin.service/controller and dashboard.service READ; rest outlined |
| `staff` | Staff accounts, roles, temporary passwords, first Super Admin bootstrap | READ |
| `platform-settings` | Key/value settings: OTP policy, search, signup, maintenance, approval, digest, admin security | outlined |
| `profiles` | Profile CRUD, completion, photos, public view, summaries, verification, approval, privacy | privacy READ; service outlined |
| `preferences` | Partner preferences | outlined |
| `search` | Filtered search with plan-gated advanced filters | READ |
| `recommendations` | Hard filter (SQL) + weighted scoring + behaviour nudge + visibility boost | outlined |
| `interactions` | Likes, shortlist, interests, matches, blocks | outlined |
| `behaviour-events` | Append-only interaction log feeding recommendations | outlined |
| `chat` | Match-only chat, membership-gated sending, SSE stream (DB polling) | outlined |
| `notifications` | In-app plus e-mail, push (FCM) and WhatsApp channels, preferences, dedupe | outlined |
| `memberships` | Plans, my membership, auto-renew flag, reminders, region/currency, visibility boost, membership gate | membership-gate READ; rest outlined |
| `payments` | Checkout, verify, webhooks, refunds, gateway config and encrypted credentials, Razorpay/PhonePe/dev providers, scaffolds for Cashfree/PayU/Paytm | payments.service READ; rest outlined |
| `invoices` | Invoice issue, PDF (pdfkit), resend, cancel, regenerate, timezone display | number/tax READ; rest outlined |
| `reports`, `warnings`, `moderation` | Member reports with auto-suspend at 5 unique reporters, warnings, suspend/ban/unban | outlined |
| `groups` | Admin-curated community groups, posts, post reports | outlined |
| `content` | Contact form inbox, support contact, success stories | outlined |
| `devices` | Push token register/list/revoke | outlined |
| `storage` | Local disk (`.storage-local/`) or S3-compatible provider; magic-byte image check; safe keys | outlined |
| `audit`, `health` | Audit writer; `/health`, `/health/ready` | READ / outlined |

## 6. Data model (66 tables)

| Domain | Tables |
|---|---|
| Members and profiles | `users`, `profiles`, `profile_photos`, `partner_preferences` |
| Reference data | `religions`, `communities`, `mother_tongues`, `educations`, `professions`, `countries`, `cities`, `marital_statuses` |
| Interactions | `likes`, `interests`, `matches`, `shortlists`, `blocks`, `behaviour_events` |
| Safety and moderation | `report_categories`, `reports`, `warning_categories`, `warnings`, `account_suspensions`, `account_bans` |
| Chat and notifications | `chats`, `chat_participants`, `messages`, `notifications`, `notification_templates` (unused), `device_push_tokens`, `digest_log` |
| Money | `membership_plans`, `memberships`, `payment_gateways`, `payments`, `transactions`, `invoices`, `invoice_logs`, `payment_refunds`, `payment_webhook_events`, `renewal_cycles` |
| Admin and settings | `admin_roles`, `permissions`, `role_permissions`, `admin_users`, `platform_settings`, `otp_configs` (singleton), `matching_weight_configs` (singleton) |
| Security and operations | `audit_logs`, `device_sessions`, `login_attempts`, `otps`, `rate_limit_counters`, `job_runs`, `backups` (unused), `recovery_logs` |
| Community and content | `community_groups`, `community_group_members`, `community_group_posts`, `community_post_reports`, `contact_messages`, `success_stories` |
| Other | `support_tickets`, `support_messages` (both unused), `ratings`, `reviews` (usage not confirmed; no feature found) |

Conventions: UUID ids generated in application code; money as integer smallest unit (`*_in_paise`, also used for USD cents); `timestamptz` everywhere; many status columns are `text` validated in services rather than enums; financial rows use `RESTRICT` foreign keys so they outlive account deletion. Profile public id `RZ` + 8 digits comes from a database sequence.

Migrations: `drizzle/0000` … `0018`, applied by `npm run db:migrate` (`drizzle-orm` migrator, tracked in `__drizzle_migrations`). Later migrations seed new permissions for `SUPER_ADMIN` only.

## 7. Background jobs

*(Runner and HTTP endpoint read in part; job definitions outlined.)* There is no scheduler inside the app. An operator runs `npm run job -- <name>` from cron, or calls `POST /api/v1/internal/jobs/<name>` with `Authorization: Bearer $CRON_SECRET` (the endpoint returns 404 unless `CRON_SECRET` is at least 32 characters). Each run takes `pg_try_advisory_xact_lock`, so overlapping runs are skipped, and records a `job_runs` row.

| Job | Purpose |
|---|---|
| `membership-expiry` | Mark expired memberships, notify once |
| `membership-reminders` | Reminders 7 and 3 days before expiry |
| `membership-renewal-failed` | Clear auto-renew and open a renewal cycle |
| `membership-dunning` | Follow-up reminders after a lapse (never charges) |
| `payment-reconcile` | Re-read stale PENDING payments and refunds, close expired orders, flag late captures |
| `account-deletion-finalize` | Anonymise accounts past the recovery window, remove photos |
| `member-digest` | Weekly opt-in summary e-mail |
| `housekeeping` | Prune rate-limit counters, webhook idempotency rows, old job history |

## 8. External integrations (status from code)

| Integration | State |
|---|---|
| SMTP (nodemailer) | Implemented (`src/server/lib/mailer.ts`, READ); used for e-mail OTP, notifications *(outlined)*, digest *(outlined)*. Mock-tested only. |
| Fast2SMS OTP API | Implemented (READ); Indian numbers only. Mock-tested only. |
| Razorpay (orders, payments, refunds, webhooks) | Implemented *(outlined)*. Mock-tested only. |
| PhonePe Standard Checkout | Implemented *(outlined)*; returns a hosted `redirectUrl` for the client. Mock-tested only. |
| Cashfree, PayU, Paytm | Scaffolds that always throw "not implemented". |
| WhatsApp (OTP) | Scaffold that always throws. WhatsApp Cloud API notification provider exists *(outlined)*. |
| FCM HTTP v1 push | Implemented server-side *(outlined)*; no client app exists. |
| S3-compatible storage | Implemented with an in-repo SigV4 signer; verified against a moto mock when available. |
| Off-box backup | Shell scripts plus `scripts/backup-offsite.ts` *(pending read)*. |

The README's "nothing is verified live" statement is consistent with the code read so far.

## 9. Security headers

* `/api/*`: `src/middleware.ts` sets CORS (all origins while `ALLOWED_ORIGINS` is unset), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, HSTS in production.
* Pages: `next.config.js` sets the same baseline plus a production CSP (`script-src 'self' 'unsafe-inline' https://checkout.razorpay.com`, `frame-ancestors 'none'`, and so on).

## 10. Deployment shape

* No Dockerfile, CI workflow, process manager config or reverse proxy config is in the repository.
* `scripts/deploy.sh`: backup → build → migrate → verify migration → health check *(outlined)*. Production guidance is in `DEPLOYMENT_PRODUCTION.md` and `PRODUCTION_ENV_REFERENCE.md` (not re-verified in this audit).
* `.next/` in the working folder is a development build (no `BUILD_ID`).
