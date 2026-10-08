# RishteyZindagi Backend — Build Status (Phase B6)

**Last updated:** 2026-09-24
**Stack:** unchanged (Next.js 14 Route Handlers, PostgreSQL 16 via Drizzle ORM, zod, vitest). New migration `0005_b6_social_interaction.sql`.

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> B5: PASS — FROZEN
> B6: PASS — FROZEN (224/224 tests passing)
> ```
> Verified independently (not just by the implementing pass): `npx tsc --noEmit` clean, `npm run build` succeeds, `npm test` → 224/224 across 22 files (162 pre-existing B1-B5 + 62 new B6). See `BACKEND.md` §50 for the full writeup.

## B6 — Social / Interaction System

Implements the tables B1 originally created as unused foundation (`likes`, `interests`, `matches`, `shortlists`, `blocks`, `report_categories`, `reports`, `warning_categories`, `warnings`) plus two new additive tables (`behaviour_events`, `account_suspensions`) and one additive column (`report_categories.is_active`).

- **Interest**: send/accept/reject/withdraw, using the frozen `interest_status` enum values (`DECLINED` = reject, `WITHDRAWN` = cancel — documented mapping, no new enum values). Reciprocal interest (B already has a pending interest to A when A sends to B) auto-accepts both and creates a match. Self-interest and duplicate active interests blocked. Blocked users can't interact.
- **Like / Shortlist**: free, idempotent (duplicate = no-op via `onConflictDoNothing`; un-like/un-shortlist of a non-existent row = no-op, not 404), self-action blocked, blocked-pair blocked. Both generate behaviour events.
- **Block/Unblock**: symmetric — removes the pair from both search (B4) and recommendations (B5) discovery in both directions, and blocks new Interest/Like/Shortlist between them. Existing interaction history is never deleted; unblocking is just removing the `blocks` row, which naturally restores visibility since the frozen search/recommendations filters just check "is there a current blocks row." **A real gap was found and fixed during implementation**: B4's search repository did not actually exclude blocked pairs (despite earlier documentation assuming it did) — this is now fixed with an additive `NOT EXISTS` subquery, disclosed as a frozen-file exception.
- **Report**: file against a seeded category (Admin can add/edit/disable categories, never hard-delete); status OPEN → DISMISSED only, via the existing `reports.resolve` permission. No automatic warning/suspend/ban as a normal review action.
- **Report threshold**: 5 **unique** reporters (not 5 reports) auto-suspends the account (`users.status = SUSPENDED`, already an existing enum value). A new `account_suspensions` event-log table tracks suspend/lift cycles so that after a lift, only reports created after the lift count toward a future threshold — the frozen `reports` table itself is untouched.
- **Warning**: admin-only (new `warnings.issue` permission, SUPER_ADMIN by default), against a seeded warning category, permanent history visible to both the user and admin, notification-only (no automatic restriction).
- **Behaviour events**: a new append-only `behaviour_events` table populated at the real trigger points (PROFILE_VIEW, LIKE, SHORTLIST, INTEREST_SENT/ACCEPTED/REJECTED, MATCH_CREATED). PROFILE_VIEW required one disclosed, minimal, additive hook into the frozen B3 `profiles.service.ts` view path (a single best-effort `recordEvent()` call).
- **B5 behaviour-provider integration**: a real `BehaviourSignalProvider` (time-decayed, capped, deduplicated) now backs B5's recommendations, replacing the previously-always-inert `NoBehaviourSignalProvider` (which remains in the codebase, untouched, as a documented fallback/test double). This required exactly one disclosed, one-line import change in the frozen `recommendations.service.ts` — pre-approved by the B6 brief itself as the designated integration seam. Tier classification still happens before any behaviour signal is consulted (structurally unchanged), so manual preference still strictly dominates and behaviour can never move a candidate across the PRIMARY/SECONDARY boundary or bypass blocks/eligibility — all proven by dedicated tests.

## Frozen-file exceptions (5, all additive/disclosed)

1. `schema.ts` — new tables/column (as above).
2. `seed.ts` — 2 new permissions + report/warning category seed data.
3. `profiles.service.ts` (B3) — one best-effort PROFILE_VIEW event-recording call.
4. `recommendations.service.ts` (B5) — one import line swapping in the real behaviour provider.
5. `search.repository.ts` (B4) — a real, previously-missing blocked-pair exclusion, added (a genuine gap fix, not a silent patch).

## Next step

B6 is reviewed, verified independently, and now **FROZEN**. B7 (Chat + Notifications) is next, building on B6's Match/Block foundation.
