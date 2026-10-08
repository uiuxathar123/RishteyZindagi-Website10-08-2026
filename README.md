# RishteyZindagi.com

Premium Indian + NRI matrimonial platform — **one Next.js 14 (App Router) + TypeScript + Tailwind project** containing the public website, the member dashboard, the admin panel and the complete REST backend (PostgreSQL 16 + Drizzle ORM).

**Status:** backend phases B1–B15 frozen; **B16 (final full-stack integration + handover)** connects every member and admin screen to the real backend. See `B16_FINAL_REPORT.md` for the evidence and `FINAL_HANDOVER.md` for the complete handover.

## Start here

| I want to… | Read |
|---|---|
| Run it on my machine | **`LOCAL_SETUP.md`** |
| Understand everything / hand it over | `FINAL_HANDOVER.md` |
| See what was verified and what is not live | `B16_RELEASE_READINESS.md`, `B16_FINAL_REPORT.md` |
| Know how every screen maps to an API | `B16_AUDIT.md` |
| Call the API | `API_REFERENCE.md` (the HTTP methods in the route files are the authority; see its B16 addendum) |
| Backend design, per phase | `BACKEND.md`, `docs/phase-status/` |
| Deploy / back up | `DEPLOYMENT.md`, `BACKUP_DR.md`, `B16_PRODUCTION_INFRASTRUCTURE.md` |

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
| `npm run db:migrate` / `db:seed` | Migrations (11) / reference data |
| `npm test` | Vitest, ~8–12 min, needs the migrated + seeded **test** DB |
| `npx tsc --noEmit` | Type-check |
| `npm run check:prod-env` | Production-readiness check of your env |

## Not live (by design — nothing is faked)

OTP delivery vendors, payment gateway SDKs, push vendor, cloud storage, WebSocket chat (the chat screen polls), and staff-management APIs do not exist yet. Each one fails honestly or is labelled "not available yet" in the UI; see `FINAL_HANDOVER.md` §21–§25 for what is required to enable each.
