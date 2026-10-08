# RishteyZindagi Backend — Build Status (Phase B2)

**Last updated:** 2026-09-22
**Stack:** unchanged from B1 (Next.js 14 Route Handlers, PostgreSQL 16 via Drizzle ORM, bcryptjs, zod, vitest) — B2 adds no new architectural dependency.

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
> delivered zip for the full 10-rule policy governing all later phases
> (no unnecessary modification, no refactors, additive-only changes, any
> genuinely required B1/B2 change reported first as a BUG FIX / SECURITY
> FIX / REQUIRED DEPENDENCY / DATABASE MIGRATION REQUIRED before it's
> made). B3 was since built on top of this, entirely additively, and was
> itself reviewed and explicitly approved and frozen by the project owner
> on 2026-09-22 — see `claude/backend-b3-status.md` and `BACKEND.md` §0b
> for B3's own freeze policy. B4 was then built entirely additively on
> top of B1+B2+B3, and was itself reviewed and explicitly approved and
> frozen by the project owner on 2026-09-22 — see
> `claude/backend-b4-status.md` and `BACKEND.md` §0c for B4's own freeze
> policy. The project owner has named **B5 — Matching + Smart
> Recommendations** as the next phase — not yet started.

See `BACKEND.md` §14–24 in the delivered zip for the full writeup — this
doc is the running project-status summary, matching `claude/backend-b1-status.md`.

## B2 — Authentication + OTP (done, PASS — FROZEN)

Built entirely on top of B1's frozen foundation: no existing table/column
altered, no frontend file touched, `register`/`login` extended in place
(B1 had explicitly built them as a minimal stand-in for exactly this).

- **OTP core**: one generic engine (`otps` table + `otp.service.ts`)
  serves all four purposes (SIGNUP/LOGIN/FORGOT_PASSWORD/NEW_DEVICE) —
  single-use, purpose-isolated, expiring, attempt-limited, DB-level
  resend cooldown/window (correct across processes, unlike B1's in-memory
  IP limiter). Codes are never stored/logged/returned in plaintext — only
  a keyed hash, same pattern as B1's session tokens.
- **Multi-step signup without a "pending" table**: draft signup fields
  live in the OTP row's `metadata` until a short-lived, single-use
  verification ticket bridges verify → set-password. No `users` row
  exists until the password step succeeds.
- **Exactly one active OTP method — enforced at the database level**,
  the brief's most emphasized rule: `otp_configs` is a true singleton
  (`CHECK (id = 1)`, one row) with a single `active_method` column — there
  is no representable DB state with two methods active. Proven by a test
  that inserts a second row directly and asserts Postgres rejects it.
- **Provider honesty**: SMS/WhatsApp/Email are scaffolds only — no real
  vendor account exists in this sandbox, so `send()` always throws
  (`ServiceUnavailableError`) rather than fabricating a delivery. Status
  today is **NOT CONFIGURED / NOT IMPLEMENTED** for all three, stated
  plainly rather than glossed over. A `DevOtpProvider`, explicitly
  **MOCKED FOR DEVELOPMENT**, is what makes the flows testable — it is
  structurally incapable of running when `NODE_ENV=production`, checked
  independently in two places, both covered by an isolated test that
  stubs production and proves the guard holds.
- **Device-aware login** via a client-supplied `X-Device-Id` header (not
  fingerprinting): an unrecognized device gets a NEW_DEVICE OTP challenge
  instead of a session; a successfully verified OTP login is itself
  treated as device proof and never triggers a separate challenge.
- **Forgot/reset password**: revokes every existing session on a
  successful reset. **Logout-all** revokes every session for a member
  (rejected for admin sessions — separate identity system, untouched).
- **Non-enumeration**: `request-login-otp`, `forgot-password`, and
  `resend-otp` all respond identically — and never touch an OTP provider
  or create a database row — for an account that doesn't exist. Proven by
  tests that query the `otps` table directly and assert zero rows.
- **RBAC reused, not reinvented**: the new `GET`/`PATCH
  /admin/otp/config` routes are gated by B1's existing
  `platform.settings.manage` permission (SUPER_ADMIN-only by default) —
  zero new authorization code, so "Staff Admin never automatically gets
  Super Admin privileges" holds by construction.
- **Audit trail**: every security-relevant event (signup OTP requested,
  register, every login variant, device-verification challenge/success,
  password-reset request/success/failure, logout, logout-all, resend,
  admin config change) writes an `audit_logs` row; every credential
  attempt (password or OTP) writes a `login_attempts` row with a
  machine-readable failure reason. Verified: no plaintext password or OTP
  code appears in any log line or audit entry anywhere in the codebase.
- **Tests: 65/65 passing** (up from B1's 25) — 5 new test files (36 new
  tests) plus 3 B1 files updated for the new signup contract, all against
  real Postgres via real route handlers, no mocking. Full breakdown in
  `BACKEND.md` §23.
- Also verified: `tsc --noEmit` clean, `next build` succeeds listing every
  new route, migrations applied cleanly to both `rishteyzindagi_dev` and
  `rishteyzindagi_test` (additive only, `\d` diffed before/after), zero
  frontend files touched (checked by file-modification time).

## Known issues / decisions worth remembering

- SMS/WhatsApp/Email OTP delivery is not implemented — the single
  biggest gap between "code-complete" and "usable in production" this
  phase. Wiring a real vendor is a self-contained change inside one
  provider file, documented in `BACKEND.md` §16. Note: per the freeze
  policy, wiring a real vendor into B2's provider files now counts as a
  change to frozen B2 code — if/when this is done, it should be reported
  first under the REQUIRED DEPENDENCY category (§0 of `BACKEND.md`)
  rather than made silently.
- Rate limiting is still in-memory/per-process for the per-route IP
  limiter (B1's limitation, inherited) — the OTP-specific cooldown/resend
  limits are DB-level and already correct across processes.
- No admin-facing view of `login_attempts`/`audit_logs` yet — written
  comprehensively but nothing reads them back; a natural future addition,
  buildable additively (new read-only routes) without touching frozen B2
  write paths.
- Mobile OTP delivery (SMS/WhatsApp) is untested against a real phone
  number — verified only through the identical code path with EMAIL and
  the dev provider standing in for any channel.
- The frontend still runs entirely on its own mock data — B2, like B1,
  wires nothing into any frontend page.

## Freeze status

**B1 and B2 are both officially approved and frozen as of 2026-09-17;
B3 and B4 are both officially approved and frozen as of 2026-09-22.**
See the FREEZE STATUS banner above, `BACKEND.md` §0 (Freeze Policy,
delivered zip) for the full 10-rule policy governing B1/B2 and every
later phase: no unnecessary modification of B1/B2, no refactors/rewrites,
no schema/API/architecture changes without a verified dependency or bug,
no style-only cleanup, dependency upgrades only when required, all
existing tests preserved, any genuinely required change reported first
under one of BUG FIX / SECURITY FIX / REQUIRED DEPENDENCY / DATABASE
MIGRATION REQUIRED, no silent changes while working on later phases,
later phases build additively on top of B1/B2, and no phase starts
automatically — `BACKEND.md` §0b for the parallel policy governing B3,
and `BACKEND.md` §0c for the parallel policy now also governing B4.

## Next phase

**B3 (User + Profile + Photos) happened and is now frozen — see
`claude/backend-b3-status.md`.** It was built entirely additively on top
of this frozen B1+B2 foundation; the one exception (a required, additive
extension to shared route middleware, needed for B3's dynamic routes to
exist at all) is reported in that doc and in `BACKEND.md` §35, per the
freeze policy's "report before changing" rule, and has since been
formally accepted as a REQUIRED DEPENDENCY.

**B4 (Partner Preferences + Search) happened and is now frozen — see
`claude/backend-b4-status.md`.** It was built entirely additively on top
of the frozen B1+B2+B3 foundation; two required, additive changes to
frozen files (a database migration adding structured income columns to
`profiles`, and exporting `profiles.service.ts`'s `resolveLookups`) are
reported in that doc and in `BACKEND.md` §43, and have since been
formally accepted.

**NEXT PHASE: B5 — Matching + Smart Recommendations.** Named by the
project owner but not started — pending further explicit instruction.
