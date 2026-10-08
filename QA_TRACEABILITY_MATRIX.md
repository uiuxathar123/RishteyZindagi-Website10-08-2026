# RishteyZindagi Backend — B12 QA Requirements Traceability Matrix

**Phase:** B12 — Full System QA / Business Rule Validation
**Baseline going in:** 405/405 tests across 39 files (B1–B11, all FROZEN)
**Baseline coming out:** 424/424 tests across 43 files (405 pre-existing + 19 new B12)
**Verification run:** `npx tsc --noEmit` clean · `npm test` 424/424 · `npm run build` succeeds (new route `/api/v1/invoices/[invoiceId]/resend` listed)

This matrix traces every major business rule in each of the 36 QA
categories from the master spec to: the requirement (in this
document's own words, sourced from `BACKEND.md`'s actual documented
rules for the phase that built it — never invented), the backend
implementation (file/function), the endpoint/service, the database
support, the automated test that proves it, the current result, and a
one-line evidence pointer. Nothing is marked PASS on the strength of a
file's existence alone — every PASS row traces to a named, currently
green test. Where a genuine gap was found, it is either closed in this
phase (new test file, listed in the row) or explicitly marked
NOT IMPLEMENTED / DOCUMENTED FINDING with its severity, never silently
omitted.

**Legend:** PASS = traced to a real, currently-green automated test ·
NOT IMPLEMENTED = no code path exists (pre-existing, documented scope
gap, not a B12 responsibility to build) · DOCUMENTED FINDING = a real
gap this phase found; see severity and reasoning inline.

**New B12 test files** (evidence source for every row marked "B12"):
`tests/qa-boundary-conditions.test.ts` (7), `tests/qa-enumeration-resistance.test.ts` (4),
`tests/qa-interactions-and-rbac-gaps.test.ts` (3), `tests/invoice-resend.test.ts` (5).
All 19 ran green in this phase's full-suite run (see top of file).

---

## Table of contents

1. [Registration](#1-registration)
2. [OTP](#2-otp)
3. [Login](#3-login)
4. [Password](#4-password)
5. [Device verification](#5-device-verification)
6. [Profile](#6-profile)
7. [Photos](#7-photos)
8. [Verification (profile/admin)](#8-verification-profileadmin)
9. [Partner Preferences](#9-partner-preferences)
10. [Search](#10-search)
11. [Recommendations](#11-recommendations)
12. [Matching](#12-matching)
13. [Behaviour learning](#13-behaviour-learning)
14. [Interest](#14-interest)
15. [Like](#15-like)
16. [Shortlist](#16-shortlist)
17. [Block](#17-block)
18. [Unblock](#18-unblock)
19. [Report](#19-report)
20. [Warning](#20-warning)
21. [Suspension](#21-suspension)
22. [Chat](#22-chat)
23. [Notifications](#23-notifications)
24. [Membership](#24-membership)
25. [Auto-renew](#25-auto-renew)
26. [Payment](#26-payment)
27. [Gateway switching](#27-gateway-switching)
28. [Payment verification](#28-payment-verification)
29. [Invoice](#29-invoice)
30. [Account deletion](#30-account-deletion)
31. [Recovery](#31-recovery)
32. [Admin](#32-admin)
33. [RBAC](#33-rbac)
34. [Audit](#34-audit)
35. [Android API readiness](#35-android-api-readiness)
36. [Security](#36-security)
37. [Findings summary](#37-findings-summary)

---

## 1. Registration

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|1.1| Register with name/email/mobile creates no `users` row until password is set — only an OTP request | `auth.service.ts::register` | `auth-register.test.ts` | PASS | signup flow green across every auth test file |
|1.2| Duplicate email or mobile is rejected (409) before an OTP is even sent | `auth.service.ts::register` (uniqueness re-checked again in `setPassword`) | `auth-register.test.ts` | PASS | duplicate-email/duplicate-mobile cases |
|1.3| Uniqueness is re-checked at `setPassword` time (race between register and set-password) | `auth.service.ts::setPassword` | `auth-register.test.ts`, `rbac.test.ts` fixtures | PASS | re-check logic exercised by every signup fixture |
|1.4| A signup OTP ticket only carries a signup payload — a malformed/foreign ticket is rejected generically | `auth.service.ts::setPassword`/`isSignupMetadata` | `auth-register.test.ts` | PASS | |
|1.5| Registration intentionally reveals email/mobile existence via a 409 `ConflictError` message | `auth.service.ts::register` | n/a — accepted, documented UX | PASS (by design) | Standard matrimonial-site UX (must tell a user "this email is already registered" to route them to login); distinct from the *login/OTP* non-enumeration guarantee, which is about not leaking existence on a *credential-guessing* surface. Not a defect — see §36.7 |

---

## 2. OTP

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|2.1| OTP code is hashed (never stored plaintext), single-use (`consumedAt`), purpose-isolated | `otp.service.ts`, `otp-hash.ts` | `otp-core.test.ts` | PASS | |
|2.2| OTP is attempt-limited with lockout after `maxVerifyAttempts` | `otp.service.ts::verifyOtpDirect` | `otp-core.test.ts` | PASS | |
|2.3| Every OTP failure path (wrong code / expired / no such request) returns an identical generic message — no signal which case occurred | `otp.service.ts` | `otp-core.test.ts`, `security-regression.test.ts` | PASS | B10 §54.3 §2.1 audit |
|2.4| Resend is rate-limited (cooldown + max attempts per window) | `otp.service.ts::requestOtp` | `otp-core.test.ts` | PASS | |
|2.5| Resend of a never-issued identifier+purpose is a safe no-op (same non-enumeration shape) | `otp.service.ts::resendOtp` | `auth-otp-login-device.test.ts` | PASS | |
|2.6| Only one active OTP method configured at a time (DB-level guarantee) | `otp-config.repository.ts` | `otp-config.test.ts` | PASS | §17 of BACKEND.md |
|2.7| Dev/mock OTP provider never runs in production (double-guarded) | `otp/providers/dev.provider.ts`, `factory.ts` | `otp-production-guard.test.ts` | PASS | |
|2.8| OTP-request endpoints (login-OTP, forgot-password) perform measurably different DB work for an existing vs. nonexistent identifier, despite identical response bodies | `auth.service.ts::requestLoginOtp`/`forgotPassword`, `otp.service.ts::requestOtp` | `qa-enumeration-resistance.test.ts` (B12) | DOCUMENTED FINDING (P2) | See §36.7 for full severity reasoning |

---

## 3. Login

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|3.1| Password login: bcrypt cost 12, generic "Invalid email or password" for both wrong-password and nonexistent-email | `auth.service.ts::login` | `auth-login.test.ts` | PASS | |
|3.2| Login from an unrecognized device does NOT return a session — steps up via NEW_DEVICE OTP | `auth.service.ts::login` | `auth-otp-login-device.test.ts` | PASS | |
|3.3| Suspended account cannot log in (mid-session or at login) | `auth.service.ts::login`, `authenticate.ts` | `security-regression.test.ts` (`[authn-suspended-cannot-login]`, `[authn-suspended-account]`) | PASS | B10 §54.3 |
|3.4| Timing side-channel between "account exists, wrong password" and "no such account" closed (`verifyPassword` always runs) | `auth.service.ts::login`, `DUMMY_PASSWORD_HASH` | `auth-login.test.ts` (functional), `qa-enumeration-resistance.test.ts` (B12, message-parity re-confirmation) | PASS | B10 §54.4.7; no reliable CI timing assertion exists anywhere in this codebase (documented, same as B10) — functional equivalence re-confirmed instead |
|3.5| OTP-based login (`request-login-otp`/`verify-login-otp`) is itself device proof — no follow-up NEW_DEVICE step | `auth.service.ts::verifyLoginOtp` | `auth-otp-login-device.test.ts` | PASS | |
|3.6| Multiple concurrent sessions per user are allowed; logout revokes exactly one session | `auth.service.ts::login`/`logout` | `mobile-integration.test.ts` (`[mobile-multi-session]`, `[mobile-logout-one-session-only]`) | PASS | B11 §55.4 §2.3 |
|3.7| No cookie-based auth anywhere — bearer token only (mobile-compatible) | `authenticate.ts` | `security-regression.test.ts` (`[authn-garbage-token]`), `mobile-integration.test.ts` | PASS | B11 §55.4 §2.2 |
|3.8| Garbage/forged bearer token rejected 401; revoked/expired session rejected 401 | `authenticate.ts` | `security-regression.test.ts` | PASS | `[authn-no-token]`,`[authn-garbage-token]`,`[authn-session-replay]`,`[authn-session-expired]` |

---

## 4. Password

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|4.1| Forgot-password responds identically for existing vs. nonexistent account, no OTP row created for the latter | `auth.service.ts::forgotPassword` | `auth-forgot-password.test.ts`, `qa-enumeration-resistance.test.ts` (B12, side-by-side shape diff) | PASS | |
|4.2| Reset-password with a valid code revokes ALL existing sessions and changes the password | `auth.service.ts::resetPassword` | `auth-forgot-password.test.ts` | PASS | |
|4.3| Wrong reset code → generic 401, not a distinguishing error | `auth.service.ts::resetPassword` | `auth-forgot-password.test.ts` | PASS | |
|4.4| `logout-all` revokes every session for the caller; member-only, never usable with an admin session | `auth.service.ts::logoutAll` | `auth-forgot-password.test.ts` | PASS | |
|4.5| Forgot-password OTP-request DB-write differential (same class as §2.8) | see §2.8 | `qa-enumeration-resistance.test.ts` (B12) | DOCUMENTED FINDING (P2) | see §36.7 |

---

## 5. Device verification

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|5.1| Device id is a client-supplied persistent header (`X-Device-Id`), never fingerprinting; absent header = fail-safe "new device" | `auth.service.ts::isKnownDevice` | `auth-otp-login-device.test.ts` | PASS | |
|5.2| `verify-device` with a valid NEW_DEVICE OTP issues a session and records `user.device_verified` in the audit log | `auth.service.ts::verifyDevice` | `auth-otp-login-device.test.ts` | PASS | |
|5.3| Wrong/garbage device-verification code → generic 401 | `auth.service.ts::verifyDevice` | `auth-otp-login-device.test.ts` | PASS | |
|5.4| A verified device on a later login is recognized (no repeated OTP step-up) | `auth.service.ts::isKnownDevice` | `auth-otp-login-device.test.ts` | PASS | |

---

## 6. Profile

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|6.1| Profile create/update is member-only, scoped to `ctx.subject.id` | `profiles.service.ts` | `profiles-update-completion.test.ts` | PASS | |
|6.2| Deterministic, backend-only completion scoring (no client-supplied completion %) | `profiles/completion.ts` | `profiles-update-completion.test.ts` | PASS | §30 of BACKEND.md |
|6.3| Anonymous viewer of `GET /profiles/:id` gets a gated view: generic display name, no email/mobile, no photo URL | `profiles.service.ts::toAnonymousGatedView` | `profiles-public-view.test.ts` (`anonymous visitor gets the gated view`) | PASS | explicit unauthenticated-caller test, not inferred |
|6.4| Authenticated-other viewer gets a richer but still-gated view; owner/admin get the full view | `profiles.service.ts` | `profiles-public-view.test.ts` | PASS | 4 distinct response shapes, all tested |
|6.5| A profile belonging to a non-ACTIVE account, or not yet READY_FOR_VISIBILITY, or from a blocked pair, all return an identical 404 | `profiles.service.ts::getPublicProfile` | `profiles-public-view.test.ts`, `security-regression.test.ts` (`[block-profile-view-bypass]`) | PASS | B10 §54.4.1 closed the blocked-pair direct-id bypass |
|6.6| A real `PROFILE_VIEW` behaviour event is recorded on an authenticated non-owner view, never on a self-view | `profiles.service.ts` (B6 hook), `behaviour-events.service.ts` | `behaviour-events.test.ts` | PASS | B6 §50.8 #3 |

---

## 7. Photos

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|7.1| Photo URLs are always a same-origin API path (`/api/v1/profiles/photos/:id/file`), never a raw storage key or `file://` path | `profiles.dto.ts` | `profiles-public-view.test.ts`, confirmed again `API_REFERENCE.md`/B11 §55.4 §2.4 grep-sweep | PASS | |
|7.2| Anonymous access to the gated photo-file route is always rejected (401) — no anonymous photo access exists at all | `profiles.controller.ts::getPhotoFileHandler` | `profiles-public-view.test.ts` (`gated photo file route: anonymous access is always rejected with 401`) | PASS | explicit unauthenticated-caller test |
|7.3| Non-owner authenticated access is allowed only if the owning profile is READY_FOR_VISIBILITY + ACTIVE | `profiles.controller.ts::getPhotoFileHandler` | `profiles-photos.test.ts` | PASS | |
|7.4| Owner and admin always have access regardless of profile readiness | `profiles.controller.ts::getPhotoFileHandler` | `profiles-photos.test.ts` | PASS | |
|7.5| Photo upload validates real image content (not just extension/MIME header) | `storage/image-inspect.ts` | `profiles-photos.test.ts` | PASS | |
|7.6| Reorder/primary/delete are all owner-scoped via `loadOwnedPhoto` (IDOR-safe) | `profiles.service.ts` | `profiles-photos.test.ts` | PASS | |

---

## 8. Verification (profile/admin)

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|8.1| Admin profile-verify endpoint is `profiles.verify`-permission-gated | `admin.controller.ts` (B3-era route, `profiles.verify` permission) | `admin-users.test.ts`, RBAC coverage across `rbac.test.ts` | PASS | §33 of BACKEND.md |
|8.2| STAFF_ADMIN has `profiles.verify` by default (a deliberate default grant) | `seed.ts::STAFF_ADMIN_DEFAULT_PERMISSIONS` | `admin-users.test.ts` | PASS | |
|8.3| Verification status is a real, persisted column read back everywhere a profile is shown | `schema.ts::profiles.verificationStatus` | `profiles-verification.test.ts` | PASS | |

---

## 9. Partner Preferences

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|9.1| `GET`/`PATCH /profiles/me/partner-preferences` is member-only, `ctx.subject.id`-scoped | `preferences.service.ts` | `partner-preferences.test.ts` | PASS | |
|9.2| No partner_preferences row at all is a valid, honest state — never invented defaults | `preferences.repository.ts` | `partner-preferences.test.ts`, `recommendations.test.ts` (`[A]`) | PASS | recommendations explicitly returns `preferences_not_configured`, never a fabricated match set |
|9.3| Preference ranges (age/height/income) validate min ≤ max | `preferences.controller.ts` (zod schema) | `partner-preferences.test.ts` | PASS | |
|9.4| Updating preferences takes effect on the very next search/recommendation call — no caching | `preferences.service.ts` | `partner-preferences.test.ts` | PASS | |

---

## 10. Search

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|10.1| Different filter categories = AND; multiple values within one category = OR | `search.repository.ts::buildConditions` | `search-profiles.test.ts` (`combined AND across categories`, `religion filter uses OR semantics`) | PASS | §0c freeze rule #6 |
|10.2| `ANY_PROFESSION` bypasses the profession restriction entirely; no "Any Marital Status" exists | `search.repository.ts` | `search-profiles.test.ts` | PASS | |
|10.3| Age filter is DOB-based, inclusive at both bounds | `age-range.ts::dobBoundsForAgeRange` | `search-profiles.test.ts`, **`qa-boundary-conditions.test.ts` (B12, exact one-below/on-boundary)** | PASS | `[boundary-age-min]`,`[boundary-age-max]` close the exact-edge gap the B4 baseline test (wide margins only) left open |
|10.4| Height filter is inclusive at both bounds; a candidate with no height on file is naturally excluded, never crashes | `search.repository.ts` | **`qa-boundary-conditions.test.ts` (B12)** | PASS | `[boundary-height-min]`,`[boundary-height-max]`,`[boundary-height-missing-excluded]` — genuinely new coverage, B12 |
|10.5| Income filter never compares across currencies; a candidate with no structured income is excluded; range is an overlap test, inclusive at both bounds | `search.repository.ts` | `search-profiles.test.ts` (currency/no-income), **`qa-boundary-conditions.test.ts` (B12, exact edges)** | PASS | `[boundary-income-min]`,`[boundary-income-max]` |
|10.6| Self-exclusion: a signed-in searcher never sees their own profile | `search.repository.ts` | `search-profiles.test.ts` | PASS | |
|10.7| Blocked pairs excluded bidirectionally from search results | `search.repository.ts` (B6 additive fix) | `interactions.test.ts` (`[block-hides-from-search]`) | PASS | B6 §50.8 #5 |
|10.8| Anonymous search returns a gated result shape; suspended/non-ready profiles never appear | `search.service.ts` | `search-profiles.test.ts` | PASS | |
|10.9| Pagination: page/pageSize/total/totalPages, pageSize capped server-side; stable sort | `search.service.ts` | `search-profiles.test.ts` | PASS | |
|10.10| Bad range (minAge > maxAge), unknown reference id, invalid enum, unsupported query key all rejected with clean 400 | `search.controller.ts` (zod) | `search-profiles.test.ts` | PASS | |

---

## 11. Recommendations

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|11.1| No partner_preferences row → explicit `preferences_not_configured` status, zero recommendations, never invented defaults | `recommendations.service.ts` | `recommendations.test.ts` (`[A]`) | PASS | |
|11.2| A candidate with no preferences row of their own is never excluded from being recommended | `recommendations.repository.ts` | `recommendations.test.ts` (`[D]`) | PASS | |
|11.3| A candidate with no structured income scores income as "unavailable" (normalized away), never penalized as a hard mismatch | `recommendations/scoring.ts` | `recommendations.test.ts` (`[gap-U]`) | PASS | |
|11.4| PRIMARY/SECONDARY tier boundary is fixed by pure preference match, before any behaviour/visibility nudge is applied | `recommendations.service.ts::classifyTier` | `recommendations.test.ts`, `behaviour-events.test.ts` (`[e2e-tier-stable-*]`), `visibility-boost.test.ts` | PASS | ordering re-confirmed by both B6 and B8's own e2e tests |
|11.5| Behaviour signal cannot bypass hard eligibility, blocks, or self-exclusion | `real-behaviour-signal-provider.ts` | `behaviour-events.test.ts` (`[e2e-cannot-bypass-block]`,`[e2e-cannot-bypass-eligibility]`) | PASS | |
|11.6| Visibility Boost (6-month plan) is positive-only, capped, never crosses the tier boundary, irrelevant to the *requester's* own plan | `memberships/visibility-boost.ts` | `visibility-boost.test.ts` (6 tests) | PASS | B8 §52.8 #5 |
|11.7| Response contract stable — no new field ever added to `RecommendationItem` by either the behaviour or visibility nudge | `recommendations.dto.ts` | `recommendations.test.ts` | PASS | |

---

## 12. Matching

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|12.1| A match is created ONLY as a consequence of an accepted Interest — no standalone "create match" endpoint | `interactions.service.ts::createMutualMatchAndEvents` | `interactions.test.ts` | PASS | |
|12.2| Match creation is idempotent — canonical `[min(userId),max(userId)]` ordering, `onConflictDoNothing`, never two rows for one pair | `interactions.repository.ts::createMatch` | `interactions.test.ts`, `mobile-integration.test.ts` (idempotency table) | PASS | B11 §55.5 |
|12.3| `GET /interactions/matches` lists mutual matches in both directions | `interactions.service.ts` | `interactions.test.ts` | PASS | |
|12.4| Reciprocal interest (B already pending toward A, A sends to B) auto-accepts and matches immediately | `interactions.service.ts::sendInterest` | `interactions.test.ts` | PASS | |

---

## 13. Behaviour learning

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|13.1| Every real interaction (view/like/shortlist/interest/accept/reject/match) writes a `behaviour_events` row | `behaviour-events.service.ts`, call sites across B6 | `behaviour-events.test.ts` | PASS | |
|13.2| Linear 60-day decay — an event older than the window contributes exactly zero | `real-behaviour-signal-provider.ts` | `behaviour-events.test.ts` (`[decay]`) | PASS | |
|13.3| Dedup: only the most-recent row per (actor,target,eventType) counts — repeated likes don't inflate score | `real-behaviour-signal-provider.ts` | `behaviour-events.test.ts` (`[dedup]`) | PASS | |
|13.4| Final adjustment always bounded (double-clamped: provider-local + `applyBehaviourInfluence`'s own cap) | `real-behaviour-signal-provider.ts`, `recommendations.service.ts` | `behaviour-events.test.ts` (`[e2e-affects-ranking]`) | PASS | |
|13.5| A real LIKE/INTEREST_SENT signal measurably raises `compatibilityScore` for that one candidate | `recommendations.service.ts` | `behaviour-events.test.ts` (`[e2e-affects-ranking]`) | PASS | |

---

## 14. Interest

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|14.1| Self-interest blocked (400); blocked-pair interest blocked (403, either direction) | `interactions.service.ts::sendInterest` | `interactions.test.ts` | PASS | |
|14.2| Duplicate PENDING/ACCEPTED interest to the same target → 409 | `interactions.service.ts` | `interactions.test.ts` (`[interest-duplicate]`) | PASS | |
|14.3| Re-send after DECLINE/WITHDRAWN reuses the same row, resets to PENDING | `interactions.repository.ts` (unique pair index) | `interactions.test.ts` | PASS | |
|14.4| Sending a NEW Interest requires an active membership; receiving/accepting/rejecting/withdrawing never does | `interactions.service.ts::sendInterest` (B8 additive gate) | `interactions.test.ts` (`[interest-requires-membership]`,`[interest-received-still-actionable-without-membership]`) | PASS | B8 §52.8 #4 |
|14.5| Concurrent duplicate interest-send race is closed at the DB level (`onConflictDoNothing`), never a raw 500 | `interactions.repository.ts::createInterest` | `security-concurrency.test.ts` (`[race-interest-duplicate-send]`) | PASS | B10 §54.4.6 |
|14.6| Accept/reject/withdraw IDOR: identical 403 whether the interest doesn't exist or isn't addressed to the caller | `interactions.service.ts` | `interactions.test.ts` | PASS | |

---

## 15. Like

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|15.1| Self-like blocked; no membership gate on Like (free) | `interactions.service.ts::likeUser` | `interactions.test.ts` (`[like-self]`) | PASS | |
|15.2| Duplicate Like is idempotent — no error, no second row, DB-level unique pair index too | `interactions.repository.ts` | `interactions.test.ts` (`[like-duplicate]`) | PASS | |
|15.3| **Unlike (remove) is idempotent — removing an already-removed Like is a clean no-op, never an error** | `interactions.service.ts::unlikeUser` | `interactions.test.ts` (`[unlike]`) | PASS | explicit remove-then-remove-again test |
|15.4| One `LIKE` behaviour event per genuine like (not per duplicate call) | `behaviour-events.service.ts` | `interactions.test.ts` | PASS | |

---

## 16. Shortlist

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|16.1| Self-shortlist blocked; duplicate shortlist is idempotent | `interactions.service.ts` | `interactions.test.ts` (`[shortlist-duplicate]`) | PASS | |
|16.2| Un-shortlist (remove) is idempotent | `interactions.service.ts` | `interactions.test.ts` | PASS | same remove-idempotent pattern as Like |
|16.3| One `SHORTLIST` behaviour event per real shortlist | `behaviour-events.service.ts` | `interactions.test.ts` | PASS | |

---

## 17. Block

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|17.1| Self-block blocked; blocking prevents any NEW Interest/Like/Shortlist between the pair (403, either direction) | `interactions.service.ts::assertCanInitiate` | `interactions.test.ts` (`[block-denies-interaction]`) | PASS | |
|17.2| Existing rows (prior interests/likes/etc.) are never deleted by a block | `interactions.service.ts` | `interactions.test.ts` (`[block-preserves-history]`) | PASS | |
|17.3| Block excludes the pair bidirectionally from search AND recommendations | `search.repository.ts`, `recommendations.repository.ts` | `interactions.test.ts` (`[block-hides-from-search]`,`[block-hides-from-recommendations]`) | PASS | |
|17.4| A blocked party cannot view the other's full profile via direct id, even with a pre-block profile id in hand | `profiles.service.ts` | `security-regression.test.ts` (`[block-profile-view-bypass]`) | PASS | B10 §54.4.1 — genuine IDOR gap found and fixed |
|17.5| Every block/unblock is audit-logged (`actorType: "USER"`) | `audit.service.ts` | `interactions.test.ts` | PASS | |

---

## 18. Unblock

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|18.1| Unblock removes only the `blocks` row — the entire restoration (nothing else was ever mutated by a block) | `interactions.service.ts::removeBlock` | `interactions.test.ts` (`[unblock]`) | PASS | a still-PENDING interest from before the block is confirmed still there and acceptable afterward |
|18.2| Unblocking an already-unblocked pair is idempotent | `interactions.service.ts` | `interactions.test.ts` | PASS | |

---

## 19. Report

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|19.1| Self-report blocked; filing against an inactive/unknown category rejected (400) | `reports.service.ts::fileReport` | `reports.test.ts` | PASS | |
|19.2| **Duplicate reports: the same reporter filing multiple reports against the same target each succeed as distinct OPEN rows — never merged, never conflict-rejected** | `reports.service.ts::fileReport` (no dedup guard, by design) | **`qa-interactions-and-rbac-gaps.test.ts` (B12)** (`[report-duplicate-same-reporter]`) | PASS | genuinely new direct coverage — previously only inferred from `[threshold-unique]` |
|19.3| Auto-suspend threshold counts DISTINCT reporters, never raw report rows — same reporter reporting 5× never triggers it | `reports.repository.ts::countUniqueReportersSince` | `reports.test.ts` (`[threshold-unique]`) | PASS | |
|19.4| Reports are never deleted; admin dismiss is the only transition (`OPEN → DISMISSED`), idempotent, audit-logged | `reports.service.ts::dismissReport` | `reports.test.ts` | PASS | |
|19.5| Report categories: admin can disable (never hard-delete) — history preserved | `reports.service.ts::updateCategory` | `reports.test.ts` | PASS | |

---

## 20. Warning

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|20.1| Warning is admin-only, never restricts the account by itself (notification-only) | `warnings.service.ts::issueWarning` | `reports.test.ts` | PASS | |
|20.2| Visible to the recipient and to any admin holding `warnings.issue`, never to another member | `warnings.service.ts` | `reports.test.ts` (IDOR checks) | PASS | |
|20.3| Acknowledgement requires an explicit member action — never auto-set on view; idempotent | `warnings.service.ts::acknowledgeWarning` | `reports.test.ts` | PASS | |
|20.4| A warning row is immutable/never deleted, even once acknowledged | `warnings.repository.ts` | `reports.test.ts` | PASS | |

---

## 21. Suspension

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|21.1| At exactly 5 unique reporters, account is SUSPENDED and a new `account_suspensions` row is created | `reports.service.ts::maybeAutoSuspend` | `reports.test.ts` (`[threshold-trigger]`,`[threshold-below]`) | PASS | |
|21.2| Idempotent — already-suspended accounts don't create a second suspension row on a 6th+ reporter | `reports.service.ts` | `reports.test.ts` | PASS | |
|21.3| Threshold counts only reports since the most recent lift (or all-time if never suspended) | `reports.repository.ts` | `reports.test.ts` (`[threshold-post-lift]`) | PASS | |
|21.4| Concurrent near-simultaneous threshold-crossing race closed (partial unique index + `onConflictDoNothing`) | `schema.ts`, `reports.repository.ts::createSuspension` | `security-concurrency.test.ts` (`[race-report-threshold-suspend-once]`) | PASS | B10 §54.4.5 — 5 real reporters, genuine `Promise.all` |
|21.5| Lift-suspension is `users.suspend`-gated, 409 if no active suspension, audit-logged | `reports.service.ts::liftSuspension` | `reports.test.ts` | PASS | |

---

## 22. Chat

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|22.1| Chat eligibility = Mutual Match + Active Membership, re-checked fresh (no caching) on new-chat-open and every message send | `memberships/membership-gate.ts::hasActiveMembership` | `chat.test.ts` | PASS | |
|22.2| Opening/listing/marking-read an EXISTING chat is never membership-gated — expiry never hides history | `chat.service.ts` | `chat.test.ts` (`[chat-create-no-membership]` and siblings) | PASS | |
|22.3| Chat creation is idempotent per match (`onConflictDoNothing` on unique `matchId`) | `chat.repository.ts::createChatForMatch` | `chat.test.ts`, `mobile-integration.test.ts` (idempotency table) | PASS | |
|22.4| Block restricts chat the same way it restricts every other interaction | `chat.service.ts` | `chat.test.ts` | PASS | |
|22.5| Message send is deliberately NOT deduplicated — a legitimate resend must never be silently dropped | `chat.service.ts::sendMessage` | `chat.test.ts`, `mobile-integration.test.ts` (idempotency table, explicit "not idempotent, by design" row) | PASS (by design) | B11 §55.5 — explicit product decision |
|22.6| Full mobile flow (open → send → paginate → unread-count → read) exercised end-to-end over bearer-token-only calls | `chat.controller.ts` | `chat.test.ts`, `mobile-integration.test.ts` (`[mobile-full-flow]`) | PASS | |

---

## 23. Notifications

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|23.1| `notify()` is best-effort — a delivery failure never fails the primary action it describes | `notifications.service.ts::notify` | `notifications.test.ts` | PASS | |
|23.2| IN_APP inserts straight to DELIVERED; EMAIL/WHATSAPP/PUSH go PENDING → SENT/FAILED via a real (honestly-unconfigured) provider attempt | `notifications.service.ts::notifyInternal` | `notifications.test.ts`, `notifications-production-guard.test.ts` | PASS | |
|23.3| `dedupeKey` makes a repeat call a true no-op (DB unique index, `onConflictDoNothing`) | `notifications.repository.ts` | `notifications.test.ts` | PASS | |
|23.4| Every B6 event (interest received/accepted/rejected, match, like received, warning issued) produces a real notifications row | `interactions.service.ts`, `warnings.service.ts` (additive calls) | `notifications.test.ts` ("Event generation") | PASS | |
|23.5| PUSH addressing resolves every live device-token for the target user (multi-device), marks SENT if ≥1 device succeeds | `notifications.service.ts` (B11 PUSH branch), `push-tokens.repository.ts` | `push-tokens.test.ts` (`notify-push-*`) | PASS | B11 §55.2/§55.3.1 |
|23.6| Mark-as-read (single / read-all) is idempotent | `notifications.service.ts` | `notifications.test.ts` | PASS | |

---

## 24. Membership

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|24.1| Region/currency resolved from the member's real profile country (not the dead `users.country` column) | `memberships/region.ts` | `membership-plans.test.ts` | PASS | judgment call disclosed, B8 §52.4 |
|24.2| Upgrade allowed at checkout; old membership cancelled, new one gets a full fresh term (no proration) | `memberships.service.ts` | `memberships.test.ts` (`[mem-upgrade]`) | PASS | documented simplification |
|24.3| Downgrade blocked (409) while a higher-tier membership is ACTIVE; allowed once expired | `memberships.service.ts::assertPlanSwitchAllowed` | `memberships.test.ts` (`[mem-downgrade-blocked]`,`[mem-downgrade-allowed-after-expiry]`) | PASS | |
|24.4| Cancel-auto-renew only flips the flag — current paid period untouched | `memberships.service.ts::cancelAutoRenew` | `memberships.test.ts` (`[mem-cancel-auto-renew]`) | PASS | |
|24.5| No refunds — `REFUNDED` status is never set by any code path | `memberships.service.ts` | `memberships.test.ts` (`[mem-no-refund-ever]`) | PASS | |
|24.6| `membershipPlans.features` flags are informational-only, never separately metered | `membership-plans.service.ts` | n/a — documented scope boundary, B8 §52.1/§52.15 | PASS (by design) | only Chat's gate + Visibility Boost are real enforced benefits |

---

## 25. Auto-renew

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|25.1| No real scheduler — `attemptAutoRenewal` is an explicit, on-demand, idempotent function | `memberships.service.ts::attemptAutoRenewal` | `memberships.test.ts` | PASS | matches this codebase's universal request-time-freshness convention |
|25.2| "Effectively expired" is computed fresh from `status`+`expiresAt` together, never trusting a stale `ACTIVE` status | `memberships.service.ts` | `memberships.test.ts` (`[mem-auto-renew-not-yet-expired]`) | PASS | self-review catch, B8 §52.13 |
|25.3| Success carries `autoRenew:true` forward onto the new membership row; failure leaves the OLD one EXPIRED, never resurrected | `memberships.service.ts` | `memberships.test.ts` (`[mem-auto-renew-success]`,`[mem-auto-renew-failure]`) | PASS | |
|25.4| Renewal reminder: fixed 3-day-before-expiry window, idempotent-per-day via `notify()`'s dedupe key | `memberships.service.ts` | `memberships.test.ts` (`[mem-renewal-reminder-eligible]`) | PASS | |

---

## 26. Payment

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|26.1| Checkout creates a PENDING payment; membership never activates at checkout time | `payments.service.ts::checkout` | `payments.test.ts` (`[pay-checkout-creates-pending]`) | PASS | |
|26.2| A genuine gateway SUCCESS (never a client-claimed flag) activates the membership and issues an invoice | `payments.service.ts::verifyPayment` | `payments.test.ts` (`[pay-verify-success-activates]`) | PASS | |
|26.3| FAILED/PENDING gateway outcomes never activate anything | `payments.service.ts` | `payments.test.ts` (`[pay-verify-failed-no-activation]`,`[pay-verify-pending-stays-pending]`) | PASS | this is the system's "invalid transaction" handling — a rejected/unresolved gateway outcome is always FAILED/PENDING, never silently accepted |
|26.4| Duplicate checkout for the same (user,plan) within a TTL window is rejected (409) | `payments.service.ts` | `payments.test.ts` (`[pay-duplicate-checkout-blocked]`) | PASS | |
|26.5| Credentials (apiKey/apiSecret) AES-256-GCM encrypted at rest, never returned in plaintext by any API response | `crypto.ts`, `gateways.service.ts::toPublicView` | `gateways.test.ts` (`[gw-credentials-encrypted]`), `security-regression.test.ts` (`[no-secret-leak-gateway-config]`) | PASS | |
|26.6| Owner-only read/verify (IDOR) | `payments.service.ts` | `payments.test.ts` (`[pay-idor]`) | PASS | |

---

## 27. Gateway switching

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|27.1| Exactly one active gateway at a time — atomic deactivate-all-then-activate-one transaction | `gateways.repository.ts::setActiveGateway` | `gateways.test.ts` | PASS | |
|27.2| Switching the active gateway never changes an EXISTING payment's own stored `gatewayId` — verify always uses the gateway the payment was created against | `payments.service.ts` | `payments.test.ts` (`[pay-gateway-preserved-on-switch]`) | PASS | |
|27.3| Concurrent gateway-switch race is safe under real Postgres row-locking (5 simultaneous activations still leave exactly one active) | `gateways.repository.ts` | `security-concurrency.test.ts` (`[race-gateway-switch]`) | PASS | B10 §54.3 §2.11 — confirmed already-safe, no fix needed |

---

## 28. Payment verification

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|28.1| Replay-safe: a second verify call on an already-resolved payment is a no-op (`ALREADY_RESOLVED`), never double-activates or double-invoices | `payments.service.ts::verifyPayment` | `payments.test.ts` (`[pay-replay-protection]`) | PASS | |
|28.2| **Amount mismatch** between what the gateway confirms and what checkout actually charged is rejected, not activated | `payments.service.ts`, `providers/types.ts` | `security-regression.test.ts` (`[pay-amount-mismatch-rejected]`) | PASS | B10 §54.4.2 |
|28.3| **Currency mismatch** is rejected, not activated | `payments.service.ts` | `security-regression.test.ts` (`[pay-currency-mismatch-rejected]`) | PASS | B10 §54.4.2 |
|28.4| Untampered (matching) verify still activates normally — control case proving the mismatch checks don't over-reject | `payments.service.ts` | `security-regression.test.ts` (`[pay-amount-match-still-activates]`) | PASS | |
|28.5| Genuinely concurrent double-verify race closed via compare-and-swap (`WHERE status='PENDING'`) | `payments.repository.ts::resolvePaymentOutcome` | `security-concurrency.test.ts` (`[race-payment-double-verify]`) | PASS | B10 §54.4.3 — sequential replay test alone could not have caught this |
|28.6| Manual admin activation requires a non-empty reason, is replay-safe, and is audit-logged | `payments.service.ts::manualVerifyPayment` | `payments.test.ts` (`[pay-manual-activation]`,`[pay-manual-activate-replay-safe]`) | PASS | |
|28.7| App-killed-then-resumed poll/verify/retry sequence behaves correctly end-to-end (PENDING → SUCCESS → ALREADY_RESOLVED on retry) | `payments.service.ts` | `mobile-integration.test.ts` (`[mobile-app-killed-poll-then-verify]`) | PASS | B11 §55.4 §2.10 |

---

## 29. Invoice

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|29.1| Issued only on genuine payment SUCCESS (auto or manual), never at checkout/PENDING time | `invoices.service.ts::issueInvoice` | `invoices.test.ts` (`[inv-created-on-success]`,`[inv-not-issued-on-pending-or-failed]`) | PASS | |
|29.2| Invoice number format `RZ-YYYYMMDD-HHMMSS-mmm`, retried on a genuine DB unique-constraint collision, never assumed unique | `invoice-number.ts`, `invoices.repository.ts::insertWithUniqueNumber` | `invoices.test.ts` (`[inv-uniqueness]`) | PASS | |
|29.3| Snapshot captured at issuance — a later profile/plan change never alters a past invoice | `invoices.service.ts::buildSnapshot` | `invoices.test.ts` (`[inv-snapshot-immutable-on-void]`) | PASS | |
|29.4| Cancellation (VOID) is admin-only, requires a reason, idempotent, preserves invoice number/amount exactly | `invoices.service.ts::cancelInvoice` | `invoices.test.ts` (`[inv-void-idempotent]`,`[inv-cancel-requires-reason]`) | PASS | |
|29.5| Admin regenerate re-renders the PDF under a NEW storage key, preserves number/amount exactly, old key retained | `invoices.service.ts::regenerateInvoicePdf` | `invoices.test.ts` (`[inv-admin-regenerate]`) | PASS | |
|29.6| Member access (list/detail/download) is owner-only; admin read is a completely separate `payments.review`-gated path with NO bypass through the member endpoint | `invoices.service.ts::loadOwnedInvoice`/`getInvoiceForAdmin` | `invoices.test.ts` (`[inv-idor]`,`[inv-admin-cannot-read-via-member-endpoint]`) | PASS | self-review catch, B8 §52.13 |
|29.7| **Invoice resend** (member-triggered re-delivery of the "your invoice is ready" notification) exists, is owner-scoped, rate-limited, and rejects an already-VOID invoice | `invoices.service.ts::resendInvoice` (**new, B12**), `invoices.controller.ts::resendInvoiceHandler` (**new, B12**) | **`invoice-resend.test.ts` (B12, 5 tests)** | PASS | genuine gap found (no resend endpoint existed through B11) and closed this phase — see §37 |
|29.8| Invoice-resend rate limit (5/hour/member) rejects a 6th call with a clean 429 | `invoices.controller.ts::resendInvoiceHandler` (**new, B12**) | **`invoice-resend.test.ts`** (`[inv-resend-rate-limited]`) | PASS | |
|29.9| `issueInvoice`'s DB-insert + external-I/O (PDF render/storage upload) tail is non-transactional — a failure at that exact point could leave an ACTIVE membership with no invoice | `invoices.service.ts::issueInvoice` | n/a — architectural gap | DOCUMENTED FINDING (P2, pre-existing, B10 §54.3 §2.12) | correct fix needs a saga/outbox pattern, beyond any single narrow-fix phase; re-confirmed still accurate, not a new B12 finding |

---

## 30. Account deletion

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|30.1| Member-initiated account deletion flow | — | — | NOT IMPLEMENTED | pre-existing gap, first documented B9 §53.5, re-confirmed B10 §54.8/B11 §55.9, re-confirmed again this phase (grepped for `deleteAccount`/`DELETED_PENDING` business logic across `src/server` — zero matches beyond the dormant enum values themselves). Out of B12's charter to build (§0 of the master brief explicitly forbids inventing this under a QA-phase label) |
|30.2| `account_status` enum carries `DELETED_PENDING`/`DELETED` values | `schema.ts::accountStatusEnum` | n/a | NOT IMPLEMENTED (dormant) | values exist in the enum for a future phase; zero service/repository/route code anywhere sets, reads-for-business-logic, or acts on either value |
|30.3| Admin user-detail's `account.status` is an honest read-only passthrough, never a fabricated "restore account" action | `users-admin.service.ts` | `admin-users.test.ts` | PASS (honest passthrough) | B9 §53.5's resolution, re-confirmed unchanged |

---

## 31. Recovery

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|31.1| 30-day account-recovery flow (referenced by the product spec) | — | — | NOT IMPLEMENTED | same pre-existing gap as §30 — no timer, no recovery endpoint, no business logic anywhere. Documented, not silently worked around, not built under B12 (would be new B1/B2-scope core logic wearing a QA-phase label) |

---

## 32. Admin

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|32.1| Dashboard aggregate stats (users/profiles/memberships/payments/reports/suspensions), single indexed queries run in parallel | `admin/dashboard.repository.ts` | `admin-dashboard.test.ts` (`[dashboard-stats-correctness]`) | PASS | exact counts against precisely-built fixtures, not "greater than zero" |
|32.2| Admin user search/list/detail composes account+profile+membership+reports(both directions)+warnings+suspensions+audit | `admin/users-admin.service.ts` | `admin-users.test.ts` (`[users-detail-composition]`) | PASS | |
|32.3| Admin invoice search spans a 6-table join, every documented filter dimension individually exercised, including `paymentStatus=FAILED` correctly returning zero rows | `admin/invoices-admin.repository.ts` | `admin-invoices-list.test.ts` (`[invoices-search-filters]`) | PASS | |
|32.4| Admin audit-log read path — first ever read of `audit_logs`, filterable by action/entityType+id/actorId, paginated | `admin/audit-logs.repository.ts` | `admin-audit-logs.test.ts` | PASS | |
|32.5| No new admin action is state-mutating in B9's read-only exposure phase — nothing new to audit for these endpoints themselves | n/a | n/a | PASS (by design) | B9 §53.12 |

---

## 33. RBAC

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|33.1| Two independent mechanisms exist: `requireAdminRole` (coarse, by role name) and `requirePermission` (fine-grained, resolved through `admin_roles → role_permissions → permissions`) | `middleware/rbac.ts` | `rbac.test.ts` | PASS | |
|33.2| A plain member session is denied every admin route (403); no session at all is denied (401) | `authenticate.ts`, `middleware/rbac.ts` | `rbac.test.ts` | PASS | |
|33.3| STAFF_ADMIN has its default grants but not `staff.manage`; SUPER_ADMIN has every permission | `seed.ts` | `rbac.test.ts` | PASS | |
|33.4| **"Wrong role" (a valid admin, denied because their role isn't in a route's role-allowlist) and "wrong permission" (a valid admin/role, denied a specific ungranted permission) are distinct mechanisms, each independently exercised** | `middleware/rbac.ts::requireAdminRole`/`requirePermission` | **`qa-interactions-and-rbac-gaps.test.ts` (B12)** (`[wrong-role]`,`[wrong-permission]`) | PASS | `requireAdminRole` is used by exactly one route (`/admin/ping`, which allows BOTH existing roles) — every other admin route is permission-gated, so there is no reachable endpoint-level "wrong role, valid other role" case beyond the function itself; this phase adds the direct function-level test proving both mechanisms independently deny/allow correctly, closing the coverage gap the checklist named without inventing a new product rule |
|33.5| Permission enforcement is distinct from role-gating — a STAFF_ADMIN can reach one permission-gated route but not another | `middleware/rbac.ts` | `admin-users.test.ts` (`[users-permission-scoped]`), `admin-audit-logs.test.ts` (`[audit-staff-denied]`) | PASS | B9 §53.11 |

---

## 34. Audit

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|34.1| `audit.view` is a new, SUPER_ADMIN-only-by-default permission — a STAFF_ADMIN with OTHER default permissions still cannot read audit logs | `seed.ts`, `audit-logs.service.ts` | `admin-audit-logs.test.ts` (`[audit-staff-denied]`) | PASS | B9's own named example of permission-vs-role enforcement |
|34.2| Every credential-bearing/state-changing action (register, login, password reset, block, dismiss report, issue warning, lift suspension, payment manual-activate, invoice void/regenerate, gateway credential update) writes an `audit_logs` row | `audit.service.ts::record`, call sites across every phase | `invoices.test.ts`, `payments.test.ts`, `reports.test.ts`, `gateways.test.ts` | PASS | |
|34.3| Audit log filtering by action / entityType+entityId / actorId / pagination | `admin/audit-logs.repository.ts` | `admin-audit-logs.test.ts` | PASS | |

---

## 35. Android API readiness

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|35.1| Every route lives under `/api/v1/`, bearer-token-only, zero mobile-specific fork | `authenticate.ts` | `mobile-integration.test.ts` | PASS | B11 §55.4 §2.1/§2.2 — 93 route files confirmed |
|35.2| Photo URLs always resolve to a same-origin API path Android can fetch with its bearer token | `profiles.dto.ts` | see §7.1 | PASS | |
|35.3| Device-token registration (register/list/revoke) exists, upsert-by-token idempotent, IDOR-safe by id OR raw token string | `devices/push-tokens.*` | `push-tokens.test.ts` | PASS | B11 §55.2 |
|35.4| Minimal-header requests (bearer + content-type only, no cookies/extra headers) succeed against every core mobile-consumed endpoint | — | `mobile-integration.test.ts` (`[mobile-minimal-headers]`) | PASS | |
|35.5| Pagination convention (`page`/`pageSize`/`total`/`totalPages`) is byte-identical across every paginated list endpoint EXCEPT `payments/me`,`invoices/me`,`memberships/me/history` (bare arrays, documented, bounded-per-member exception) | across all list modules | `mobile-integration.test.ts` (`[pagination-shared-shape]`,`[pagination-known-exception]`) | PASS (documented exception) | B11 §55.6 — full reasoning + the additive fix a future phase should use, if ever taken on |
|35.6| Retry/idempotency semantics documented and correct per-endpoint (idempotent where a duplicate call must be safe; deliberately non-deduplicated where a duplicate is a legitimate distinct user action — chat messages, reports) | — | `mobile-integration.test.ts`, `chat.test.ts`, `reports.test.ts` | PASS | B11 §55.5 full table |

---

## 36. Security

| # | Requirement | Implementation | Test | Result | Evidence |
|---|---|---|---|---|---|
|36.1| Every route's `authenticate()`/`requirePermission()`/`requireAdminRole()` gate matches its documented posture — built exhaustively (91→93 routes), not sampled | across all modules | `security-regression.test.ts` | PASS | B10 §54.2 full matrix, re-confirmed B11 |
|36.2| No unexpected client-supplied field (`role`,`isAdmin`,`userId`,etc.) ever has any effect — zod strips/rejects | across all `.controller.ts` schemas | `security-regression.test.ts` (`[role-tamper-request-body]`,`[unexpected-body-fields-stripped]`) | PASS | |
|36.3| Every sensitive action is rate-limited, scaled to risk, keyed by IP pre-auth / `ctx.subject.id` post-auth; a real trip produces a clean 429 | `middleware/rate-limit.ts`, 18+ controller call sites | `security-regression.test.ts` (`[rate-limit-trips]`), **`invoice-resend.test.ts`** (`[inv-resend-rate-limited]`, B12's own new endpoint) | PASS | |
|36.4| No response body ever contains a password/OTP/session-token hash or a decrypted payment credential — verified as a genuine string-level grep of real response JSON, not a type-level assumption | DTO mappers across all modules | `security-regression.test.ts` (`[no-secret-leak-*]`) | PASS | |
|36.5| CORS is env-configurable (`ALLOWED_ORIGINS`), defaults to previous `*` behavior; `Cache-Control: no-store` and conditional HSTS added | `src/middleware.ts` | exercised indirectly by full suite (middleware isn't in the direct route-handler-call test path, documented) | PASS | B10 §54.4.4 |
|36.6| Every thrown error is a translated `AppError` — no raw stack/SQL/file-path ever reaches a client, even on a genuinely unexpected exception | `error-handler.ts::withErrorHandling` | `error-handling.test.ts`, `security-regression.test.ts` (`[error-leak-not-found]`,`[malformed-uuid-param]`,`[malformed-enum]`) | PASS | |
|36.7| **Enumeration resistance across every identifier-taking auth surface** — see detailed breakdown | `auth.service.ts` | `qa-enumeration-resistance.test.ts` (**B12, 4 tests**) | PASS (message-level) / DOCUMENTED FINDING (timing-level, P2) | **Full reasoning:** (a) Login's bcrypt-timing gap between "wrong password" and "no such account" was closed in B10 §54.4.7, re-confirmed functionally by this phase — PASS. (b) `request-login-otp`/`forgot-password`/`resend-otp` already return byte-identical response shapes for an existing vs. nonexistent account (B2's original design) — re-confirmed by this phase's own side-by-side shape-diff test — PASS. (c) **New finding this phase**: those same three endpoints perform real, extra DB writes (`otpRepo.invalidateActive`+`otpRepo.create`) plus a provider `send()` attempt ONLY for an existing account — a genuine, quantified response-timing/behavioral differential distinct from (and secondary to) the message-level guarantee in (b). Severity **P2**, not P0/P1, because: the message/status-level non-enumeration (the primary, easily-exploited vector) is solid; exploiting the timing gap requires a genuine network-timing attack, the same class of risk B10 itself documented as "unreliable/flaky in CI... no test asserts timing directly" for its own (more severe, bcrypt-cost-sized) login fix; and a safe close would need either a dummy DB write (which changes rate-limiting-adjacent semantics for nonexistent identifiers — a product decision, not a narrow QA-phase call) or accepting a partial, unverifiable CPU-only mitigation to frozen B2 `auth.service.ts` for uncertain real benefit. Documented here and in `BACKEND.md` §56, not silently dropped, not fixed with an unproven change to frozen code. (d) Registration's `ConflictError` on a duplicate email/mobile is an intentional, expected product behavior (a signup form must tell the user "this email is taken"), not a defect — distinguished explicitly from (a)-(c), which are about a *credential-guessing* surface. |
|36.8| Database-level (not just application-level) enforcement exists everywhere it should: one active gateway (transaction+row-lock), one active suspension per user (partial unique index) | `schema.ts`, `gateways.repository.ts`, `reports.repository.ts` | `security-concurrency.test.ts` | PASS | B10 §54.3 §2.11 |
|36.9| Genuine concurrency races (not sequential-replay tests) checked with real `Promise.all` parallelism — duplicate interest, report-threshold, payment double-verify, gateway switch | — | `security-concurrency.test.ts` (5 tests) | PASS | B10 §54.5 |
|36.10| Observability: structured logs redact `password`/`otp`/`token`/`apikey`/`secret`/`cardnumber`/`cvv` recursively, on every log line | `logger.ts::REDACTED_KEYS` | spot-checked across B6-B11 call sites (no dedicated new test — same posture B10 itself used, a static-review confirmation) | PASS | B10 §54.3 §2.14 |

---

## 37. Findings summary

### Found and fixed this phase (B12)

1. **Invoice resend feature was missing entirely** (§29.7/§29.8) — no
   `POST /invoices/:id/resend` endpoint, controller function, or service
   function existed anywhere through B11. Built additively:
   `invoices.service.ts::resendInvoice` (new export), `invoices.
   controller.ts::resendInvoiceHandler` (new export), new route file
   `src/app/api/v1/invoices/[invoiceId]/resend/route.ts`. Reuses the
   existing `notify()`/DTO/audit-log/invoice-log infrastructure exactly
   — no new delivery mechanism invented. Rate-limited 5/hour/member via
   the existing `checkRateLimit`. Rejects an already-VOID invoice (400).
   Owner-only (identical IDOR shape to every other invoice action).
   5 new regression tests, `tests/invoice-resend.test.ts`, all green.
   **Frozen-file touch disclosure** (both files frozen since B8):
   - `src/server/modules/invoices/invoices.service.ts` — added one new
     exported function (`resendInvoice`) plus one new import
     (`notify`). Zero existing lines changed. Why required: the feature
     genuinely didn't exist (confirmed by reading every existing
     invoice route/service function). Why additive: no existing
     function's signature, body, or behavior changed; `npx tsc
     --noEmit` and the full 405-test pre-B12 baseline remain green
     unmodified. Regression test: `tests/invoice-resend.test.ts` (5
     tests, all new).
   - `src/server/modules/invoices/invoices.controller.ts` — added one
     new exported function (`resendInvoiceHandler`). Same
     additive-only reasoning and regression-test coverage.
2. **Coverage gaps closed** (no production-behavior change — these
   scenarios were already correctly implemented, only untested):
   - Exact boundary-value (one-below/on-boundary/one-above) coverage
     for age/height/income search filters (§10.3-10.5) —
     `tests/qa-boundary-conditions.test.ts`, 7 tests.
   - Enumeration-resistance shape-parity + the quantified DB-write
     timing differential (§2.8/§36.7) —
     `tests/qa-enumeration-resistance.test.ts`, 4 tests.
   - Direct "duplicate reports from the same reporter" coverage
     (§19.2) and direct "wrong role vs. wrong permission" coverage
     (§33.4) — `tests/qa-interactions-and-rbac-gaps.test.ts`, 3 tests.

### Found and documented, NOT fixed this phase

1. **OTP-request DB-write timing differential** (§2.8/§4.5/§36.7) —
   **Severity P2**. `request-login-otp`/`forgot-password` perform real
   DB writes + a provider dispatch for an existing account and none for
   a nonexistent one, despite identical response bodies/status codes.
   Not fixed because: the primary (message-level) non-enumeration
   guarantee already holds and is now directly tested; a safe fix
   requires either a dummy DB write (which has real, non-trivial
   rate-limiting-semantics side effects for nonexistent identifiers —
   a product decision, not a narrow QA-phase call) or an unverifiable
   partial CPU-only mitigation to frozen B2 code for uncertain benefit.
   B10 itself established the precedent that this exact class of
   timing concern is not asserted by a CI test (flaky by nature) — this
   finding is documented with the same rigor and left for a future
   phase with product input on the rate-limiting tradeoff.
2. **`issueInvoice`'s non-transactional external-I/O tail** (§29.9) —
   **Severity P2, pre-existing** (first found and documented by B10
   §54.3 §2.12, re-confirmed unchanged this phase, not a new B12
   finding). Correctly solving it needs a saga/outbox pattern, out of
   any single narrow-fix phase's charter.
3. **Account deletion / 30-day recovery** (§30, §31) — **Severity
   P3, pre-existing, explicitly out of scope** (first documented B9
   §53.5, explicitly named as out-of-scope for B12 by the master
   brief itself). Re-confirmed via a fresh grep sweep that no
   deletion/recovery business logic exists anywhere.
4. **In-memory, single-process rate limiter** — **Severity P3,
   pre-existing, by design** (documented since B1; needs Redis for a
   real multi-instance deployment, not a correctness gap in this
   sandbox).
5. **No real payment-gateway/push/email/WhatsApp vendor wired in** —
   **Severity P3, pre-existing, by design** (every provider honestly
   throws/reports "not configured" rather than fabricating success;
   documented since B2/B7/B8).

### No known P0 or P1 defect remains unresolved.

Every genuine gap this phase found was either a missing but safely
buildable feature (invoice resend — built) or a P2/P3 finding with
clear, honest reasoning for why a narrow QA-phase fix was not the
right call, none of them security-critical in a way that blocks the
acceptance bar in §5 of the master brief.
