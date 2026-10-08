# RishteyZindagi Backend — Build Status (Phase B5)

**Last updated:** 2026-09-24
**Stack:** unchanged from B1-B4 (Next.js 14 Route Handlers, PostgreSQL 16 via Drizzle ORM, zod, vitest). This gap-fix round adds one new table (`matching_weight_configs`, migration `0004`) — the first schema change B5 has made; still no change to any B1-B4 table.

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> B5: PASS — IMPLEMENTED / PENDING FREEZE (162/162 tests passing)
> ```
> B5 (Matching + Smart Recommendations) completed its original three-step
> process (audit, product-rules draft, FINAL lock + implementation,
> 141/141 tests), then underwent a **read-only pre-freeze business-logic
> audit**, which surfaced four gaps against the FINAL product rules:
> (1) no distinction between primary (in-range) and secondary
> ("You may also like", out-of-range) recommendations, (2) no
> behaviour-learning foundation, (3) no admin-configurable matching
> weights, (4) missing coverage for all of the above plus several edge
> cases. This **gap-fix round** closed all four gaps. B5 is still **not
> frozen** — implementation is complete and all verification has passed,
> but the project owner has not yet reviewed/approved this round.
>
> (Note added at export time: the B6 status doc and every later doc record
> B5 as subsequently reviewed and PASS — FROZEN. This file is reproduced
> exactly as it was last saved in the project.)

See `BACKEND.md` §48 (original implementation) and **§49 (this gap-fix
round)** in the delivered project for the full writeup — this doc is the
running project-status summary, matching `claude/backend-b1-status.md`
through `claude/backend-b4-status.md`.

## B5 gap-fix round — what changed

**1. Primary vs. Secondary ("You May Also Like") recommendations.**
Every scored candidate is now classified into exactly one tier:
`PRIMARY` (no category scored `NO MATCH`/outright mismatch) or
`SECONDARY` (at least one category mismatched, but the candidate still
cleared the existing evidence floor). Classification happens purely
from the explicit-preference score breakdown, before any behaviour
signal is consulted, so it can never be influenced by behaviour data.
The response shape is now `{ status, items, secondaryItems,
secondaryTotal, page, pageSize, total, totalPages }`: `items` is the
paginated PRIMARY list (unchanged contract otherwise); `secondaryItems`
is a bounded, unpaginated "you may also like" shelf (max 10 candidates,
minimum score 40, shown only alongside page 1); every `RecommendationItem`
now carries an explicit `tier: "PRIMARY" | "SECONDARY"` field so clients
never have to infer it from the score. A candidate never appears in
both lists.

**2. Manual-preference priority (documented, not just implemented).**
The priority hierarchy is now explicit in both `scoring.ts` and
`BACKEND.md` §49.3: hard eligibility (SQL) → explicit preference
compatibility (decides tier) → behavioural signals (bounded score nudge
only, applied after tier is fixed) → secondary discovery. Because tier
is computed before behaviour is ever read, "manual preference stays
primary over behaviour" is a structural guarantee, not a convention.

**3. Behaviour-learning foundation.** A clean interface
(`BehaviourSignalProvider`) with a single shipped implementation
(`NoBehaviourSignalProvider`) that always returns "no signal available."
No fake data, no reads from tables B1-B5 never populate (`likes`,
`interests`, `matches`, `shortlists` are genuinely empty — reading them
and presenting that as "learning" would itself have been fabrication).
The seam is wired into the scoring pipeline with a hard cap
(`MAX_BEHAVIOUR_SCORE_ADJUSTMENT = 5`) so that once a real signal source
exists, it can only ever nudge a score, never override tier. Real
behaviour ingestion is documented as future (B6+) scope.

**4. Admin-configurable matching weights.** New singleton-row table
`matching_weight_configs` (same pattern as B2's `otp_configs`: `id
integer PRIMARY KEY DEFAULT 1`, hand-added `CHECK (id = 1)`, seeded via
`INSERT ... ON CONFLICT DO NOTHING`). New endpoint `GET/PATCH
/api/v1/admin/matching/weights`, gated by the **existing** B1-seeded
`platform.settings.manage` permission (SUPER_ADMIN by default — no new
permission was invented; this permission was already used identically
by the B2 OTP-config endpoint for the same class of platform-setting
change) and audit-logged on every update via the existing `audit_logs`
table. Validation requires all ten categories present, no unknown
categories, non-negative finite integers, summing to exactly 100 —
anything else is rejected with no partial write. When no config row
exists, `getActiveWeights()` falls back to the same ten default weights
B5 originally shipped with (documented as an intentional, more lenient
variant of the OTP-config precedent, which throws instead). Weights are
read fresh on every recommendations request — no caching — so an admin
change takes effect on the very next `GET`, with zero deployment.
`scoreCandidate`'s new `weights` parameter is optional and defaults to
the original fixed weights, so **default-configuration output is
byte-identical to before this round** — confirmed by every pre-existing
exact-score test continuing to pass unchanged.

**5. Real-time refresh (clarified, not changed).** Confirmed to mean
request-time freshness only: every `GET` recomputes from the current
profile, preferences, candidate pool, and active weight config. No
WebSockets, no push, no new caching layer — verified directly by two
new tests that mutate state between two calls to the same endpoint.

**6. Tests.** 21 new tests added, 3 existing tests updated to reflect
the new tiered response contract (not weakened — same assertions,
updated to point at the now-correct array/field), for a new total of
**44/44 passing** in `tests/recommendations.test.ts`. Combined with the
untouched B1-B4 baseline: **162/162 passing**, zero regressions. Also
verified: `tsc --noEmit` clean, `next build` succeeds listing the new
admin route, and a file-modification-time sweep confirming no B1-B4
source file was touched beyond one disclosed, additive dependency (next
section).

## Frozen-file dependency (disclosed, additive only)

`tests/db.test.ts` (frozen, part of B1) asserts an *exact* count of
database tables. Adding the new, required `matching_weight_configs`
table raised the true count from 48 to 49, which broke that one
count assertion — not any of its 48 per-table existence checks, all of
which still pass unchanged. Per the gap-fix instruction's own frozen-file
protocol, this was applied and explicitly disclosed rather than silently
patched: the `expected` array gained one new, correct entry
(`"matching_weight_configs"`) and the count comparison was updated to
match; every original assertion in the file is otherwise untouched. This
mirrors B4's own already-accepted precedent for the same kind of
required, additive, frozen-file touch (see `BACKEND.md` §43). Full
4-part disclosure (file / reason / behavioral impact / why additive-
without-touching was impossible) is in `BACKEND.md` §49.10.

## B6 boundary (unchanged)

The gap-fix round still implements no likes, interests, matches
persistence, shortlist, block/unblock workflow, reports, chat, or
notification logic, and no real behaviour-signal ingestion (the
foundation is in place; a real provider is B6+ scope).

## Next step

Implementation is complete and all verification has passed, but **B5
(including this gap-fix round) has not yet been reviewed or frozen by
the project owner** — that review/freeze is the next expected step. No
B6 work has been started.
