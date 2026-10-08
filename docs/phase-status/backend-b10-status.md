# RishteyZindagi Backend — Build Status (Phase B10)

**Last updated:** 2026-09-28
**Stack:** unchanged. New migration `0008_b10_security_hardening.sql` (one additive partial unique index).

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> B5: PASS — FROZEN
> B6: PASS — FROZEN
> B7: PASS — FROZEN
> B8: PASS — FROZEN
> B9: PASS — FROZEN
> B10: PASS — FROZEN (381/381 tests passing)
> ```
> Verified independently: `npx tsc --noEmit` clean, `npm run build` succeeds, `npm test` → 381/381 across 37 files (353 pre-existing B1-B9 + 28 new B10). The 4 new concurrency/race-condition tests were additionally re-run standalone and confirmed passing. Several of the disclosed frozen-file fixes were spot-checked directly against source. See `BACKEND.md` §54 for the full audit writeup, including a complete endpoint authorization matrix.

## B10 — API Security / Hardening / Production Reliability

A cross-cutting audit of the entire B1-B9 surface (auth, authorization, IDOR, input validation, rate limiting, webhook/payment security, data exposure, headers/CORS, error handling, DB integrity, transactional integrity, concurrency, observability) — **not a rewrite**. The codebase was found unusually disciplined going in; most areas were confirmed secure with no changes needed. Seven narrow, genuine gaps were found and fixed, each additive and individually regression-tested:

1. **Blocked-pair direct profile-view bypass** — `getPublicProfile` (the direct-by-id view path) never checked block status, even though search/recommendations/chat already did. Fixed with one guard reusing B6's existing block-check helper.
2. **Payment verify amount/currency cross-check** — verify never confirmed what the gateway reported matches what was actually charged at checkout. Added as optional provider-result fields; a mismatch is now rejected.
3. **Payment double-verify race** — two simultaneous verify calls could both activate a membership and issue a duplicate invoice. Fixed with a genuine compare-and-swap (`WHERE status='PENDING'`) guard.
4. **Static `*` CORS replaced with environment-configurable policy** — a new `ALLOWED_ORIGINS` env var (unset = old behavior, byte-identical) via a new Edge middleware, since no real frontend/Android origin has ever been fixed in this still-pre-launch project — the honest resolution, not a guessed production domain.
5. **Report-threshold auto-suspend race** — 5+ concurrent reports could create two concurrently-active suspension records. Fixed with an additive partial unique index.
6. **Interest-send duplicate race** — simultaneous duplicate sends could raw-500 instead of a clean 409. Fixed with a conflict-safe insert.
7. **Login timing side-channel** — a nonexistent-email login skipped the password-hash comparison entirely, creating a timing gap. Fixed with a fixed-cost dummy comparison always run.

One finding was explicitly identified and **left as a disclosed limitation, not silently patched**: `issueInvoice`'s non-transactional external I/O tail after commit would need a saga/outbox pattern to fully close — correctly judged as beyond a "narrow fix," documented rather than worked around.

Also produced: a complete **endpoint authorization matrix** covering every route in `src/app/api/v1/` (method, auth requirement, permission/role, ownership/block/membership checks) — a standing audit reference in `BACKEND.md` §54.2 — and a new 28-test security/concurrency regression suite (`tests/security-regression.test.ts`, `tests/security-concurrency.test.ts`) covering auth/authz bypass, IDOR, privilege escalation, OTP/session/webhook replay, payment tampering, rate-limit enforcement, malformed/oversized input, and error/secret-leakage prevention.

## Scope restraint honored

The three already-known, already-documented limitations (in-memory single-process rate limiter, no real payment-gateway SDK, no account-deletion/recovery flow) were explicitly **not** "fixed" by inventing new infrastructure — re-confirmed as accurately documented and left alone, exactly as the phase's own ground rules required.

## Frozen-file exceptions (12 files, all disclosed, additive/narrow security or bug fixes with regression tests)

`profiles.service.ts` (B3), `payments.service.ts`/`payments.repository.ts`/`providers/types.ts`/`providers/dev.provider.ts` (B8), `reports.repository.ts`/`reports.service.ts`/`schema.ts` (B6/shared), `interactions.repository.ts`/`interactions.service.ts` (B6), `auth.service.ts` (B2), plus `next.config.js`'s static CORS headers removed in favor of the new middleware. Full 4-part disclosure for each is in `BACKEND.md` §54.4.

## Next step

B10 is reviewed, verified independently (including a standalone re-run of its concurrency tests), and now **FROZEN**. B11 (Android Backend Integration / Mobile API Readiness) is next — a mobile-readiness pass over the existing, now-hardened v1 API surface.
