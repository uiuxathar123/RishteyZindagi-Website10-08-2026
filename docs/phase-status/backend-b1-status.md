# RishteyZindagi Backend — Build Status (Phase B1)

**Last updated:** 2026-09-22
**Stack:** Next.js 14 Route Handlers (`src/app/api/v1/*`) + TypeScript, PostgreSQL 16 via Drizzle ORM + node-postgres, bcryptjs, zod, vitest.

> ## FREEZE STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN (see claude/backend-b3-status.md)
> B4: PASS — FROZEN (see claude/backend-b4-status.md)
> NEXT PHASE: B5 — Matching + Smart Recommendations
> ```
> B1 and B2 were reviewed and explicitly approved and frozen by the
> project owner on 2026-09-17. See `BACKEND.md` §0 (Freeze Policy) in the
> delivered zip for the full 10-rule policy now governing all future
> phases. B3 was built entirely additively on top of this, was reviewed
> and explicitly approved and frozen by the project owner on 2026-09-22
> (see `claude/backend-b3-status.md` and `BACKEND.md` §0b for B3's own
> freeze policy). B4 was then built entirely additively on top of B1+B2+B3,
> and was itself reviewed and explicitly approved and frozen by the
> project owner on 2026-09-22 (see `claude/backend-b4-status.md` and
> `BACKEND.md` §0c for B4's own freeze policy). The project owner has
> named **B5 — Matching + Smart Recommendations** as the next phase — not
> yet started.

**B2 (Authentication + OTP) is done — see `claude/backend-b2-status.md`.**
**B3 (User + Profile + Photos) is done — see `claude/backend-b3-status.md`.**
**B4 (Partner Preferences + Search) is done — see `claude/backend-b4-status.md`.**
This doc is left exactly as B1 delivered it, since B1 is frozen.

See `BACKEND.md` in the delivered zip for the full architecture writeup —
this doc is the running project-status summary, matching the pattern of
`claude/frontend-phase1-status.md` for the frontend track.

## B1 — Backend Foundation & Architecture (done, PASS — FROZEN)

First backend development step. Built directly inside the existing
`rishteyzindagi-web/` Next.js project (confirmed via inspection that no
backend, database, ORM or `.env` existed beforehand) rather than a
separate repo, per the brief's "reuse existing infrastructure" rule.

- **Database/ORM pivot, and why:** Prisma was the first choice and the
  full schema was written in Prisma — then abandoned. Prisma's CLI needs
  to download a native query-engine binary from `binaries.prisma.sh`,
  which this sandbox's egress allowlist blocks outright (confirmed:
  every attempt returned 403/connect_rejected). Switched to **Drizzle
  ORM + `pg`** (pure-JS Postgres driver, npm-registry only, no native
  binary) — equally first-class for Next.js/TypeScript, and the schema
  maps 1:1 back to Prisma if a future deployment environment has open
  egress and prefers it.
- **PostgreSQL 16 installed and running in this sandbox** (`apt-get
  install postgresql`) with two databases — `rishteyzindagi_dev` and a
  separate `rishteyzindagi_test` — so tests never touch dev data.
- **All 46 entities from the brief** modeled in
  `src/server/db/schema.ts`, migrated via `drizzle-kit generate` +
  a custom idempotent `db:migrate` script (tracks applied migrations,
  safe to re-run). Verified: `\dt` in psql lists all 46 tables.
- **Layered architecture**: `route.ts` (thin) → `*.controller.ts`
  (validate + shape response) → `*.service.ts` (business rules) →
  `*.repository.ts` (only files touching Drizzle tables directly).
  Cross-cutting: `src/server/lib/` (errors, response envelope, password
  hashing, session tokens, structured logging, zod validation),
  `src/server/middleware/` (authenticate, rbac, rate-limit,
  error-handler).
- **Working API routes** (health, auth register/login/logout, users/me,
  profiles/me create+get, admin login, admin RBAC-demo ping) — everything
  else from the brief's module list has schema only, per B1's explicit
  scope control (no OTP, no matching, no chat, no payments, no complete
  signup/login UX — all B2+).
- **RBAC**: `admin_roles`/`permissions`/`role_permissions`, seeded with a
  starter permission set; `SUPER_ADMIN` gets everything, `STAFF_ADMIN` a
  deliberately smaller default (no arbitrary unlimited admin privileges,
  per the brief). `admin_users` is a separate identity system from
  member `users`, mirroring the frontend's already-separate Admin Panel
  login.
- **Security**: bcrypt (cost 12) passwords, opaque (non-JWT) session
  tokens hashed at rest, zod input validation everywhere, centralized
  error handling that never leaks internal messages/stack traces, basic
  security headers + CORS on `/api/*` (CORS currently `*` — documented as
  a foundation choice, to be scoped once real client origins exist),
  an in-memory rate-limit foundation (documented as needing Redis for a
  multi-instance deployment), redacted structured logging, `.env`
  actually git-ignored (it wasn't before this phase — fixed).
- **Tests: 25/25 passing**, against the real test Postgres database,
  calling the actual exported route handlers with real `NextRequest`
  objects — not mocked. Covers: DB connection + all 46 tables present +
  seed data; health endpoint; user creation validation; duplicate email/
  mobile prevention; password hashing (real bcrypt verify/reject);
  RBAC (401 unauthenticated / 403 wrong-subject-type / 200 correct role,
  plus fine-grained permission checks); centralized error handling
  (AppError → correct envelope; unexpected Error → generic 500 that
  provably never leaks the real message).
- Also verified outside the test suite: fresh `npm install` (no flags
  needed) succeeds; `tsc --noEmit` clean across the whole project;
  `next build` succeeds, listing all 8 new API routes alongside every
  existing frontend route, unchanged; a live `npm start` HTTP smoke test
  against `/api/v1/health` and `/api/v1/auth/register` worked.
- **Frontend safety**: confirmed zero frontend files touched this phase
  (`find ... -newer package-lock.json` across every frontend directory
  returned nothing) — only `package.json` (scripts), `next.config.js`
  (added `headers()` for `/api/*`), `.gitignore` (now actually ignores
  `.env`), and new files under `src/server/`, `src/app/api/`, `tests/`,
  plus `drizzle/`, `BACKEND.md`, `.env.example`.

## Known issues / decisions worth remembering

- Prisma is not usable in this sandbox (egress-blocked binary download)
  — Drizzle is the working substitute here; re-evaluate if a real deploy
  environment has open egress and the team has a Prisma preference.
- `npm audit` flags vulnerabilities in `next@14.2.35` (pre-existing,
  pinned by the frontend — out of B1's scope to touch) and in the new
  dev-only `vitest`/`vite` (never ships to production).
- The frontend still runs entirely on its own mock data — this backend
  is not wired into any frontend page yet, through B1-B4 alike.
- Local dev requires a running PostgreSQL instance the user provisions
  themselves (not bundled in the delivered zip) — `.env`/`.env.test` were
  deliberately excluded from the zip (they contain this sandbox's local
  dev credentials, meaningless elsewhere); `.env.example` documents every
  variable needed. See BACKEND.md §11 for first-time setup commands.

## Next phase

**B1, B2, B3, and B4 are all frozen** — B1 and B2 as of 2026-09-17, B3
and B4 both as of 2026-09-22. See the FREEZE STATUS banner above,
`BACKEND.md` §0 (the original B1/B2 Freeze Policy), §0b (the B3-specific
Freeze Policy), and §0c (the B4-specific Freeze Policy) for the full
rules now governing all future work.

**Status: B2 happened — see `claude/backend-b2-status.md`. B3 happened —
see `claude/backend-b3-status.md`. B4 happened — see
`claude/backend-b4-status.md`.**

**NEXT PHASE: B5 — Matching + Smart Recommendations.** Named by the
project owner but not started — pending further explicit instruction.
