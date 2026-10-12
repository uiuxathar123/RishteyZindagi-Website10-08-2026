# Frontend and Backend Architecture

This document describes the implementation in this repository, not a planned
or production deployment architecture. It was verified against the local
workspace, its route handlers and services, and a localhost-only Super Admin
session. No production host was contacted.

## System shape

```text
Browser
  ├─ Next.js pages and React components
  ├─ /bff/* ── same-origin session proxy; browser sends httpOnly cookies
  │               └─ /api/v1/* ── controller → service → repository
  └─ authenticated server-rendered layouts ── direct local /api/v1/* call
                                              │
                                              └─ Drizzle ORM → PostgreSQL
```

The BFF is a session transport boundary, not a replacement backend. The
versioned API is authoritative for authentication, permissions, input
validation, ownership and business rules. The API and server-side rendered
page helpers both use the same server services and PostgreSQL data model.

## Frontend entry points

Next.js App Router pages are rooted in `src/app/`:

| Route group | Source | Responsibility |
|---|---|---|
| Public site | `src/app/(marketing)/` | Home, search, informational pages, login/signup, membership and payment return |
| Member area | `src/app/dashboard/` | Signed-in member overview, profile, matches, interests, messages, membership and settings |
| Admin area | `src/app/admin/` | Separate Admin sign-in and Staff/Super Admin panels |
| Versioned API | `src/app/api/v1/` | Backend route handlers |
| Same-origin proxy | `src/app/bff/[...path]/route.ts` | Cookie-backed proxy from browser requests to the versioned API |

`src/app/(marketing)/layout.tsx` provides public chrome. The member
`src/app/dashboard/layout.tsx` validates the member session on the server,
loads the unread-notification count, and supplies the member shell and session
context. `src/app/admin/(panel)/layout.tsx` validates an Admin session and
provides the Admin shell and role/permission context. The nested Super Admin
layout is also a UI guard; API authorization remains mandatory.

Client API helpers live in `src/lib/api/`. `client.ts` sends same-origin
requests, unwraps the common response envelope and maps failures to `ApiError`.
`hooks.ts` provides cancellable `useAsync` loads and pending/error-aware
actions. `AsyncView` renders loading skeletons, retryable error states, empty
states or loaded data. Reference lookup requests are deduplicated by an
in-memory promise cache in `lookups.ts`; failures are not retained.

### Admin dashboard request behavior

The Staff Admin overview (`src/components/admin/OverviewClient.tsx`) starts
these independent requests without awaiting one another:

* `GET /bff/admin/dashboard` — platform stat aggregates.
* `GET /bff/admin/users?pageSize=8` — recent signups.
* `GET /bff/admin/dashboard/trends?days=30` — India-time trend series.

Each panel has its own `useAsync` state and skeleton/error rendering; the
stats do not wait for the trends request. Trends can be reloaded for 7, 30 or
90 days. The Super Admin overview
(`src/components/admin/SuperOverviewClient.tsx`) independently loads dashboard
stats and the first five audit-log entries. Its stat cards and activity list
therefore also resolve independently.

Presentation helpers in `src/lib/format.ts` format dates with the browser's
`en-IN` locale and its local timezone; they do not explicitly pin a timezone.
The trends API itself returns `YYYY-MM-DD` dates calculated using
`Asia/Kolkata`. Monetary values are stored/returned in the currency's
smallest unit and formatted by currency. Invoice timestamp handling is in the
invoice module and is separate from dashboard date formatting.

## Backend API and execution layers

The API is grouped by feature under `src/app/api/v1/`:

| Route family | Examples |
|---|---|
| Authentication | `/auth/register`, `/auth/login`, `/auth/verify-*`, `/auth/logout`, password recovery |
| Admin identity and controls | `/admin/login`, `/admin/me`, `/admin/roles`, `/admin/staff`, platform/security/OTP settings |
| Admin operational views | `/admin/dashboard`, `/admin/dashboard/trends`, `/admin/users`, `/admin/reports`, approvals, audit logs, payments |
| Member and profile | `/users/me`, `/profiles/me`, profile photos, partner preferences, recommendations |
| Discovery and interactions | `/search/profiles`, `/interactions/*`, matches, likes, interests, blocks and shortlist |
| Membership and money | `/membership-plans`, `/memberships/*`, `/payments/*`, `/invoices/*`, webhooks |
| Communication and community | `/chats/*`, `/notifications/*`, `/groups/*`, support/contact and stories |
| Platform operations | health/readiness, reference data, devices, site status and internal jobs |

The route files are thin HTTP adapters. Most export a handler wrapped with
`withErrorHandling` from `src/server/middleware/error-handler.ts`. That wrapper
applies the shared rate-limit policy and maintenance gate, assigns a request
ID, maps application errors to the standard response envelope, and logs
endpoint status and duration. Controllers parse and validate input (typically
with Zod), establish authentication context where required, and call feature
services. Services enforce feature/business rules and authorization, then call
repositories. Repositories use Drizzle queries against `src/server/db/schema.ts`.

`src/middleware.ts` is a separate Next middleware layer for API CORS and
security headers; it is not the authentication or role-authorization layer.
`src/server/db/client.ts` owns the shared PostgreSQL pool and Drizzle client.

## Database and domain model

The Drizzle schema is `src/server/db/schema.ts` and contains 66 table
declarations. Its main domains include:

* Identity and profiles: users, profiles, profile photos, partner preferences,
  sessions, login attempts and OTP records/configuration.
* Discovery and safety: reference/look-up data, interests, likes, matches,
  shortlists, blocks, reports, warnings, suspensions and behaviour events.
* Membership and finance: plans, memberships, gateways, payments,
  transactions, invoices, refunds, webhook events and invoice logs.
* Administration and operations: admin users, roles, permissions, role grants,
  platform settings, audit/security records, jobs, backups and rate-limit
  counters.
* Messaging and community: chats, participants, messages, notifications,
  support, community groups/posts/reports, contact messages and stories.

Database constraints, indexes, relations and enums are defined alongside the
Drizzle table declarations. Ordered SQL migrations live under `drizzle/`.
This architecture document does not ask for, or apply, a migration.

## Authentication, OTP and authorization boundaries

### Browser sessions and BFF

`src/lib/bff/config.ts` defines three distinct cookies: member session
(`rz_session`), Admin session (`rz_admin_session`) and a non-secret device ID.
The BFF in `src/app/bff/[...path]/route.ts` selects the member or Admin cookie
based on the requested namespace, attaches the bearer token only on the
server-to-server request, and never returns the session token in a successful
login response body. It applies an origin/Sec-Fetch-Site check to state-changing
browser requests and clears the relevant cookie on logout or an attached
session's 401 response.

`src/lib/api/server.ts` is used by protected server-rendered layouts. It reads
the appropriate httpOnly cookie and calls the API with its bearer token from
the server; signed-out or invalid sessions are represented as no identity and
the layout redirects to the corresponding login page.

### Member authentication and OTP

`src/server/modules/auth/auth.controller.ts` validates auth request bodies,
applies route-specific rate limits, and dispatches to `auth.service.ts`.
Member login can be password/device-aware or OTP-based. Signup is a
register → verify signup OTP → set password flow. Password recovery, device
verification and logout are distinct flows. Session tokens are generated for
the client boundary, but only their hashes are stored in `device_sessions`.

`src/server/modules/otp/otp.service.ts` coordinates providers and the
`otp_configs`/`otps` repositories. OTP rows are purpose- and identifier-scoped,
store a keyed code hash rather than the plaintext code, expire, limit attempts,
and are consumed once. Provider selection is in
`src/server/modules/otp/providers/`; development delivery is guarded to
non-production use. OTP policy/configuration does not replace password,
session or authorization checks.

### Admin and Super Admin permissions

Admin identities are stored separately from member users (`admin_users`,
`admin_roles`, `permissions`, `role_permissions`). The Admin login service is
`src/server/modules/admin/admin.service.ts`; optional Admin MFA is controlled
by the Super Admin security setting and uses the email OTP path.

`authenticate` in `src/server/middleware/authenticate.ts` hashes the presented
bearer token, finds a live non-revoked session, checks expiry and confirms the
associated member or Admin account is active. For Admin identities it also
loads the role name. `requireAdminRole` and `requirePermission` in
`src/server/middleware/rbac.ts` reject member identities; the permission
helper resolves role grants from the database and refuses permissioned work
while a staff member must change a temporary password.

`GET /api/v1/admin/me` returns the signed-in Admin's own identity and
permission keys for UI presentation. `AdminSessionProvider.can()` hides
screens/links the current role does not have, but this is only a presentation
aid: each protected API service checks its permission again. Super Admin-only
settings also use role checks where applicable.

## Verified request-to-database flows

### Super Admin dashboard statistics

```text
SuperOverviewClient
  → adminApi.get("/dashboard")
  → GET /bff/admin/dashboard
  → BFF attaches rz_admin_session as a bearer token
  → GET /api/v1/admin/dashboard
  → withErrorHandling → authenticate → dashboard controller
  → dashboard service → requirePermission("users.view")
  → dashboard repository → parallel Drizzle aggregates
  → PostgreSQL users/profiles/memberships/payments/reports/suspensions
```

The stats service starts its independent repository groups with `Promise.all`.
The repository uses indexed count/sum queries, including grouped revenue by
currency; open and in-review report counts are added without loading report
rows. No cross-user or shared cache is involved. The route returns
`{ success, data: { stats }, message }`.

The trends request follows the same authenticated controller/service path and
returns a bounded 7–90 day series. Its SQL groups users, verified successful
payments/revenue and reports by the `Asia/Kolkata` business-day boundary,
zero-fills missing days and returns ISO calendar dates.

### Recent Admin signups and Super Admin activity

Recent signups use the separately permissioned `/admin/users?pageSize=8` route
and its users-admin controller/service/repository; only the requested page is
rendered. Super Admin activity uses `/admin/audit-logs?pageSize=5` and the
audit-log feature's own layers. The frontend does not serialize these requests
behind the totals request.

### Protected member dashboard

```text
GET /dashboard
  → server layout reads rz_session
  → serverGet("member", "/users/me") → API auth + users service/repository
  → if signed in, serverGet unread count
  → render SessionProvider + DashboardShell + requested page
```

Subsequent member components use `api` → `/bff/*` → member API routes. The
member cookie is never selected for `/bff/admin/*`; Admin routes never accept
a member identity as an Admin.

### Login/session establishment

```text
LoginForm/AdminLoginForm
  → /bff/auth/login or /bff/admin/login
  → auth/admin controller validates body and rate-limits
  → service verifies password and account state
  → optional OTP/device-verification step when policy requires it
  → create device_sessions row containing token hash
  → BFF moves returned session token into the matching httpOnly cookie
```

The signup and recovery flows use their own purpose-specific OTP verification
and short-lived tickets; they do not bypass their code, expiry or attempt
checks.

## Local verification notes

The following are localhost-only observations from this workspace; they are
not production performance claims:

* The existing API load test (`tests/performance-load.test.ts`) passed all
  nine scenarios; its Admin dashboard result was p50 17 ms / p95 39 ms in
  that test run.
* With the local Super Admin credential explicitly configured in `.env`
  (credential values are intentionally not recorded here), Admin login,
  `/admin/me`, dashboard stats, 7-day trends, audit logs, `/admin`,
  `/admin/super` and logout all returned HTTP 200. The Admin identity returned
  the `SUPER_ADMIN` role with 18 permission keys.
* On the local Next.js development server, first requests to newly compiled
  Admin routes took seconds, then repeat requests were much quicker:
  dashboard stats 3,177 ms → 104 ms; `/admin/super` 4,365 ms → 153 ms.
  Those first-hit timings include development route compilation; they are not
  database-only or production timings. Trends returned seven valid
  `YYYY-MM-DD` dates in the requested India-time window.
* Browser automation in the shared browser context did not have the local
  Admin cookie. The authenticated dashboard flow was therefore verified
  through local HTTP requests, including server-rendered page responses, not
  through an authenticated browser interaction trace. No password, session
  token or `.env` value is included in this document.

## Local compiler scope

The root `tsconfig.json` includes `**/*.ts` and `**/*.tsx` and excludes
`node_modules` plus `gate1/files`. `gate1/files` is the repository's ignored,
untracked Gate 1 archival snapshot; it is not an active application import
tree. The verified compiler program contains application source and tests and
does not contain paths from that snapshot. The exclusion is limited to that
directory and does not exclude `src/`, `tests/`, or the current `gate1` script.
