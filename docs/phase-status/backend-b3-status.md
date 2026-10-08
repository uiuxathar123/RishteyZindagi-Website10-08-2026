# RishteyZindagi Backend — Build Status (Phase B3)

**Last updated:** 2026-09-22
**Stack:** unchanged from B1/B2 (Next.js 14 Route Handlers, PostgreSQL 16 via Drizzle ORM, bcryptjs, zod, vitest) — B3 adds no new architectural dependency (the one new small dependency-free module is a local-disk photo storage adapter, not a package).

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> NEXT PHASE: B5 — Matching + Smart Recommendations
> ```
> B3 was explicitly requested via a "B3 START" instruction that also
> reiterated the B1/B2 freeze rules (no unnecessary modification, no
> refactors, additive-only, any genuinely required frozen-file change
> reported first). B3 was reviewed and **explicitly approved and frozen
> by the project owner on 2026-09-22**, at 94/94 tests passing. A
> B3-specific 10-rule Freeze Policy now governs all future phases in
> addition to the original B1/B2 policy — see `BACKEND.md` §0b. B4 —
> Partner Preferences + Search was subsequently built additively on top
> of B1+B2+B3, completed, and **explicitly approved and frozen by the
> project owner on 2026-09-22**, at 118/118 tests passing, with its own
> 10-rule Freeze Policy — see `BACKEND.md` §0c. The project owner has
> named **B5 — Matching + Smart Recommendations** as the next phase, but
> B5 has **not** been started and will not begin without a further
> explicit instruction.

See `BACKEND.md` §25–38 (and §0b/§0c for the B3/B4 freeze policies) in
the delivered zip for the full writeup — this doc is the running
project-status summary, matching `claude/backend-b1-status.md`,
`claude/backend-b2-status.md`, and `claude/backend-b4-status.md`.

**B4 (Partner Preferences + Search) is done — see `claude/backend-b4-status.md`.**

## B3 — User + Profile + Photos (done, PASS — FROZEN)

The fresh audit B3's brief asked for (before writing any code) found that
B1's schema foundation already modeled almost the entire data shape —
`profiles`, `profile_photos`, and every lookup table (religions, mother
tongues, educations, professions, countries, cities, marital statuses,
communities) already existed, correctly shaped, completely empty, with
zero business logic on top. So B3's real work was: additive schema
columns for what was missing, reference-data seeding, and the entire
service/controller/route layer, none of which existed before.

- **No duplicate user/account concept**: `profiles.userId` is B1's
  existing unique FK to `users`; every response's `displayName` is
  `users.name` joined in at read time, never duplicated into the
  profiles table.
- **Profile fields**: gender, DOB (age always derived at read time, never
  stored), country/city, marital status, religion (mandatory single
  value), community/caste (scoped to a religion), mother tongue,
  education, profession (each a required controlled-lookup primary value
  plus an optional array of additional selections), income
  range+currency, height (normalized cm), optional structured lifestyle/
  family-details jsonb, about me.
- **Closed vs. open-ended lookups**: religions/mother tongues/educations/
  professions/marital statuses/countries are seeded, closed lists (future
  search/matching filters, so consistency matters); cities and
  communities/castes are open-ended by nature and created on first use
  via a case-insensitive find-or-create scoped to a country/religion — no
  exhaustive world database was hand-seeded, so onboarding is never
  blocked by a missing entry.
- **Deterministic, backend-only profile completion**: one pure function
  drives every response path and the persisted columns alike. 12 required
  fields + a live photo check → `INCOMPLETE` / `COMPLETE` (all 12, no
  photo) / `READY_FOR_VISIBILITY` (all 12 + ≥1 photo). No endpoint accepts
  a client-supplied percentage.
- **Three-audience profile visibility** (`GET /profiles/:profileId`):
  owner/admin gets full detail; any other authenticated user gets the
  full non-sensitive view (no email/mobile) but only once the target is
  `READY_FOR_VISIBILITY`; anonymous gets exactly the brief's fixed
  boundary (`"Member Profile"`, age, country, city, education, profession,
  verification badge, `photoBlurred` flag) — no photo URL of any kind. A
  not-ready or inactive-account profile is a plain 404 to non-owners,
  never a different error.
- **Photos**: a small storage-provider abstraction (local-disk dev
  adapter today, same honest "not implemented" failure as B2's OTP
  providers for any other provider name); real magic-byte + dimension
  validation without an image library; JPEG/PNG/WEBP, ≤5MB, ≥200×200px
  when determinable, ≤10 photos/profile; exactly one primary at all times
  (transactional); deleting the primary promotes the next one; deleting
  the last photo flips completion back to INCOMPLETE automatically. All
  photo delivery goes through one gated, backend-controlled route — owner
  and any admin always, another authenticated user only once the profile
  is ready, anonymous never (401).
- **Admin verification foundation**: one PATCH endpoint, gated by B1's
  pre-existing `profiles.verify` permission (already granted to
  STAFF_ADMIN by default) — zero new authorization code. A normal user
  cannot reach it or smuggle `verificationStatus` through their own
  profile-update endpoint (that schema is `.strict()` and doesn't accept
  the field at all).
- **IDOR coverage**: every mutation re-derives the caller's own profile
  from their session; cross-user photo delete/set-primary/reorder and
  reading a not-ready profile are all explicitly tested and rejected.
- **Tests: 94/94 passing** (65 existing B1+B2 + 29 new B3), all against
  real Postgres via real route handlers, no mocking. Full breakdown in
  `BACKEND.md` §37.
- Also verified: `tsc --noEmit` clean, `next build` succeeds listing every
  new route alongside every existing route unchanged, migration
  `0002_b3_profile_photos.sql` applied cleanly to both databases
  (additive only — one new enum, no dropped/altered column, verified via
  `\d` before/after), zero frontend files touched (file-modification-time
  sweep).

## One required, additive change to shared B1 middleware

**Reported per the freeze rules' "report before changing" requirement**,
and **formally accepted by the project owner in the B3 freeze
instruction as a REQUIRED DEPENDENCY that must remain stable**: B3 needed
dynamic route segments (`/profiles/[profileId]`, etc.) and B1 never built
one — `withErrorHandling` didn't thread Next.js's route params through at
all. Fixed by adding an optional second argument and exposing it as
`ctx.params`; every existing single-argument call site (all of B1+B2's
routes) is unaffected, since none of them read `ctx.params` — proven by
running the full existing 65-test B1+B2 suite unchanged before and after.
This is the only change to any B1/B2 file's *behavior*; every other
frozen-file touch (schema.ts, seed.ts, env.ts, .gitignore) is a pure
addition of new columns/fields/entries. Full detail in `BACKEND.md` §35,
and the B3-specific freeze policy recording this acceptance is in
`BACKEND.md` §0b.

## Known issues / decisions worth remembering

- Income bands aren't a controlled lookup yet — no product spec in this
  repo names them, so `incomeRange` is validated free text plus an
  explicit currency rather than a guessed-at dropdown list. Converting to
  a lookup table later is a fully additive change. (B4 subsequently added
  structured `incomeMinAmount`/`incomeMaxAmount` integer columns to
  `profiles` alongside this text field, to support database-level range
  search — see `claude/backend-b4-status.md`.)
- Photo storage is local-disk only; no real cloud provider is wired up
  (fails loudly if one is requested rather than silently using local
  disk).
- No image processing anywhere — no resizing/thumbnailing/real blurring;
  the anonymous view is a boolean flag with no photo URL, left to the
  frontend to render as a placeholder.
- No admin UI for verification/photo review — only the data model + one
  PATCH endpoint; a full review screen is B11 scope.
- Matching remains schema-only, exactly as B1 left it, and is not
  implemented by B3 or B4 — Partner Preferences + Search (B4) is now
  built and frozen (see `claude/backend-b4-status.md`); Matching + Smart
  Recommendations is B5 scope, not yet started.
- The frontend still runs entirely on its own mock data — B3, like B1,
  B2, and B4, wires nothing into any frontend page.

## Freeze status

**B3 is FROZEN as of 2026-09-22** (B3-specific 10-rule Freeze Policy in
`BACKEND.md` §0b: no refactors, no cleanup-only changes, no unnecessary
schema/contract changes, no B1/B2 modification, the error-handler
dependency accepted as required and stable, all 94/94 tests preserved,
future phases build additively, any genuinely required frozen-code
change reported first under BUG FIX / SECURITY FIX / REQUIRED DEPENDENCY
/ DATABASE MIGRATION REQUIRED, no silent changes, no automatic phase
start). **B4 — Partner Preferences + Search is also FROZEN as of
2026-09-22**, with its own 10-rule Freeze Policy in `BACKEND.md` §0c
(same shape of rules, scoped to B4, plus an explicit prohibition on
starting B5 automatically). Both policies remain in force together with
the original B1/B2 policy (`BACKEND.md` §0).

## Next phase

All four phases delivered so far — B1, B2, B3, and B4 — are **PASS —
FROZEN** (B1/B2 as of 2026-09-17; B3/B4 as of 2026-09-22).

**NEXT PHASE: B5 — Matching + Smart Recommendations.** Named by the
project owner but **not started** — pending further explicit
instruction, per Freeze Policy rule 10 (`BACKEND.md` §0c).
