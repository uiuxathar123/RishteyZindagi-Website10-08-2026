# RishteyZindagi Backend — Build Status (Phase B4)

**Last updated:** 2026-09-22
**Stack:** unchanged from B1/B2/B3 (Next.js 14 Route Handlers, PostgreSQL 16 via Drizzle ORM, bcryptjs, zod, vitest) — B4 adds no new architectural dependency.

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> NEXT PHASE: B5 — Matching + Smart Recommendations
> ```
> B4 was explicitly requested via a "B4 START" instruction that reiterated
> the B1/B2/B3 freeze rules (no unnecessary modification, no refactors,
> additive-only, any genuinely required frozen-file change reported first
> as BUG FIX / SECURITY FIX / REQUIRED DEPENDENCY / DATABASE MIGRATION
> REQUIRED). B4 was reviewed and **explicitly approved and frozen by the
> project owner on 2026-09-22**, at **118/118 tests passing**. A
> B4-specific Freeze Policy now governs all future phases in addition to
> the original B1/B2 and B3 policies — see `BACKEND.md` §0c. The project
> owner has named **B5 — Matching + Smart Recommendations** as the next
> phase, but B5 has **not** been started and will not begin without a
> further explicit instruction.

See `BACKEND.md` §39–47 (and §0c for the B4 freeze policy) in the
delivered zip for the full writeup — this doc is the running
project-status summary, matching `claude/backend-b1-status.md`,
`claude/backend-b2-status.md`, and `claude/backend-b3-status.md`.

## B4 — Partner Preferences + Search (done, PASS — FROZEN)

A fresh audit (before writing any code, per the brief) found that
`partner_preferences` already existed as a B1 schema-only foundation
table — empty, no business logic, the same pattern B1 used for
`profiles`/`profile_photos` before B3 built on them. Most of its columns
already matched B4's confirmed requirements exactly; two did not
(`religionIds` was multi-select where the brief wants religion preference
to be single-select, and `incomeMin` was a bare string with no max or
currency) — rather than alter or drop either, B4 added correctly-shaped
new columns and left the two mismatched originals unused. No search/
filter infrastructure existed at all before B4; that's the bulk of the
actual new work.

- **Partner preferences** (`GET`/`PATCH /profiles/me/partner-preferences`):
  one configuration per profile, owner-only by construction (no route
  accepts a target id). Age/height ranges, single-select religion,
  multi-select community/mother-tongue/education/profession/marital-status,
  an explicit `professionAny` flag for ANY_PROFESSION (mutually exclusive
  with a non-empty `professionIds`), country/city, and income
  min/max/currency. **No "Any Marital Status" value exists.** No hidden
  defaults — an unconfigured profile's `GET` returns `{ preferences: null }`,
  never an invented "all of everything" object. Every referenced id is
  validated against the real reference tables; range fields
  (age/height/income) are validated `min <= max`. Audit-logged
  (`partner_preferences.created`/`.updated`) — individual searches are
  not logged, per the brief's explicit "don't add search history without
  a stated requirement."
- **Search** (`GET /search/profiles`): deterministic, database-level
  filtering — never loads all profiles and filters in memory. Works for
  both anonymous and signed-in callers, reusing B3's own privacy boundary
  (`toAuthenticatedPublicView`/`toAnonymousGatedView`) for every result
  row rather than a second implementation of it. Only
  `READY_FOR_VISIBILITY` + `ACTIVE`-account profiles are eligible;
  self-exclusion is enforced server-side for signed-in callers. Filters:
  gender, age range (via a DOB-bounds conversion that matches B3's own
  `computeAge` definition exactly), religion/community/mother-tongue/
  education/marital-status (each OR-multi via `IN (...)`), profession
  (OR-multi, or `anyProfession=true` to skip the filter entirely),
  country/city (structured equality, AND'd together), height range, and
  income range (requires an explicit `incomeCurrency` — never compares
  across currencies, and a profile with no structured income is
  naturally excluded). Filter categories combine with AND; multiple
  values within one category combine with OR. Pagination (default page
  size 20, **server-enforced max 50** — rejected, not silently clamped)
  and deterministic sorting (`updatedAt`/`createdAt`, with `profiles.id`
  as a stable tie-breaker) are both real SQL, not in-memory. No matching
  score, ranking, or recommendation logic exists anywhere — that's
  exclusively B5.
- **Indexes added** (all additive): `profiles(date_of_birth)`,
  `profiles(height_cm)`, `profiles(education_id)`, and a composite
  `profiles(income_currency, income_min_amount, income_max_amount)`. B1
  had already indexed every other search-filter column in anticipation
  of this phase.
- **Tests: 118/118 passing** (94 existing B1+B2+B3 + 24 new B4 — 9
  partner-preference tests, 15 search tests), all against real Postgres
  via real route handlers, no mocking. Full breakdown in `BACKEND.md`
  §44.
- Also verified: `tsc --noEmit` clean, `next build` succeeds listing every
  new route alongside every existing route unchanged, migration
  `0003_b4_partner_preferences_search.sql` applied cleanly to both
  databases (additive only — two new `profiles` columns, nine new
  `partner_preferences` columns + one new FK, four new indexes, verified
  via `\d` before/after), zero frontend files touched (file-modification-
  time sweep).

## Two required, additive changes to frozen files

**Reported per the freeze rules' "report before changing" requirement,
and formally accepted by the project owner in the B4 freeze instruction**:

1. **DATABASE MIGRATION REQUIRED** — `profiles` gains
   `incomeMinAmount`/`incomeMaxAmount` (nullable integers). B3's
   `incomeRange` is free text and can't support the database-level range
   comparison income search needs. Optional, independently settable via
   the existing `PATCH /profiles/me` endpoint, not part of profile
   completion — no existing column, index, or required-field rule
   changed.
2. **REQUIRED DEPENDENCY** — `profiles.service.ts`'s `resolveLookups`
   changed from module-private to exported, so search can reuse it
   (rather than duplicate B3's privacy-boundary logic, which the brief
   explicitly disallows). Zero behavior change — only its export
   keyword changed, proven by the full 94-test B1+B2+B3 suite passing
   unchanged before and after.

Both are now accepted as stable, permanent parts of the frozen B3/B4
surface — see `BACKEND.md` §0c rule 3/8. Full detail (including the
audit reasoning for the two unused legacy `partner_preferences` columns)
is in `BACKEND.md` §39 and §43.

## Known issues / decisions worth remembering

- Search matches only a profile's PRIMARY mother tongue / education /
  profession selection, not B3's optional "additional selections" jsonb
  arrays — keeps filtering at the database level without jsonb-
  containment queries; normalizing those into join tables is a fully
  additive future change.
- No currency conversion for income search — a search in one currency
  only ever matches profiles captured in that exact currency.
- No search history.
- Partner preferences and search are deliberately independent — searching
  never overwrites saved preferences, and preferences aren't
  automatically applied as default search filters. A "search using my
  saved preferences" convenience is a natural additive future addition.
- No admin UI for search or preferences — API-only.
- The frontend still runs entirely on its own mock data — B4, like
  B1/B2/B3, wires nothing into any frontend page.

## Freeze status

**B4 is officially approved and frozen as of 2026-09-22**, at 118/118
tests passing. See the STATUS banner above and `BACKEND.md` §0c for the
full B4-specific freeze policy now governing every later phase: no
refactors/rewrites of B4, no unnecessary B4 schema/API changes, no B1/B2/B3
modification, frozen migrations untouched, the 118/118 test baseline
preserved, search semantics (AND across categories, OR within a category,
ANY_PROFESSION, no "Any Marital Status") held fixed, pagination/stable
sorting/DOB age filtering/same-currency income filtering/visibility
rules/anonymous gating/self-exclusion/IDOR protections all preserved, any
genuinely required change reported first under BUG FIX / SECURITY FIX /
REQUIRED DEPENDENCY / DATABASE MIGRATION REQUIRED, no silent changes, and
no phase starts automatically.

## Next phase

**NEXT PHASE: B5 — Matching + Smart Recommendations.** Named by the
project owner but **not started** — pending further explicit
instruction, per Freeze Policy rule 10 (§0c).
