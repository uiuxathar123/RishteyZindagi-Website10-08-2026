# B16 — Final Full-Stack Integration: Pre-Change Audit

Written **before any B16 code was changed**. Everything below was verified
against the actual repository, the real local database and the running
backend (dev server + live HTTP probes), not against earlier documents.
Where an earlier document disagrees with the code, the code wins and the
disagreement is recorded (§9).

---

## 0. Phase naming note (read first)

This session already contains a frozen phase called **"B16 — Production
Infrastructure, Deployment & Real-Integration Foundation"** (an audit/design
phase; `B16_PRODUCTION_INFRASTRUCTURE.md`, 466/466 tests). The instruction for
this phase also calls itself "B16 — Final Full-Stack Integration".

This is a **label collision, not a contradiction in B1–B15** (see §1). To keep
both histories unambiguous, the documents record:

* **B16a** = Production Infrastructure (already frozen, untouched).
* **B16b** = Final Integration (this phase). File names follow the instruction
  exactly (`B16_AUDIT.md`, `B16_RELEASE_READINESS.md`, `B16_FINAL_REPORT.md`,
  `FINAL_HANDOVER.md`). None collides with an existing file.

B17 is not started.

---

## 1. Freeze integrity check (Step 2)

Source: the `BACKEND.md` freeze banner, `docs/phase-status/backend-bN-status.md`,
and the last full-suite result.

| Phase | Recorded status | Contradiction found? |
|---|---|---|
| B1–B8 | PASS — FROZEN | No |
| B9 | PASS — FROZEN (353/353 at its freeze) | No |
| B10 | PASS — FROZEN (381/381) | No |
| B11 | PASS — FROZEN (405/405) | No |
| B12 | PASS — FROZEN (424/424) | No |
| B13 | PASS — FROZEN (448/448) | No |
| B14 | PASS — FROZEN (458/458) | No |
| B15 | PASS WITH DOCUMENTED LIMITATIONS — FROZEN | No (instruction says "PASS / FROZEN"; the recorded status is the more precise "WITH DOCUMENTED LIMITATIONS" — all 13 limitations are non-blocking and documented) |
| B16a | PASS WITH DOCUMENTED LIMITATIONS — FROZEN (466/466) | n/a (see §0) |

**Baseline re-measured today from a clean copy of the project:** `npx tsc
--noEmit` clean, `npm test` = **52 files / 466 tests, 0 failed**, `npm run
build` clean (this was the handover-verification run earlier in this session).

**Result: no earlier phase is incomplete or contradictory. Proceeding.**
A byte-for-byte snapshot of the project was taken before any change so that
"frozen files untouched" can be proven by diff at the end.

---

## 2. What the project actually is today

| Layer | State (measured) |
|---|---|
| Backend | 95 API routes under `/api/v1`, 52 DB tables, 11 migrations, 52 test files / 466 tests — complete and green |
| Backend auth | **Stateless `Authorization: Bearer <token>`**; no cookies are ever read. Member and admin sessions live in the same `device_sessions` table but with different subject types; RBAC via `admin_roles → role_permissions → permissions` |
| Frontend | Next.js 14 App Router. 37 pages. **Every data-bearing screen reads `src/data/*` mock arrays through `src/services/*`; there is not one real network call in the UI** (the only `fetch(` strings are in comments) |
| Frontend ↔ backend | **Not connected at all** |
| Database (dev) | Migrated (52 tables). Seeded reference data present **except `communities` = 0 rows**. 0 users, 1 dev Super Admin (from `SEED_DEV_SUPER_ADMIN`), 0 staff admins |
| Providers | OTP SMS/WhatsApp/Email = scaffolds that throw "service unavailable"; dev OTP provider exists; payment gateways = scaffolds + a mock gateway for dev; storage = local disk only |

---

## 3. Architecture decisions for the integration (with reasons)

### D1 — Session transport: same-origin proxy with httpOnly cookies
The backend only understands `Authorization: Bearer`. Putting that token in
`localStorage` would expose it to any XSS (the instruction forbids insecure
storage). Decision: a thin Next.js route group **`/bff/*`** (outside
`/api/v1`, so the frozen API surface and its CORS/security middleware are not
touched):

* Login-type responses (`login`, `verify-device`, `verify-login-otp`,
  `set-password`, `admin/login`) have the `sessionToken` **removed from the
  JSON** and stored in an **httpOnly, SameSite=Strict, Secure-in-production
  cookie**. The browser's JavaScript never sees a session token.
* Every other call: the proxy reads the cookie, adds the `Authorization`
  header, forwards to the real `/api/v1` handler and relays status/body
  (including binary photo/PDF responses).
* **Two separate cookies** — `rz_session` (member) and `rz_admin_session`
  (admin) — and the proxy refuses to attach the wrong one: `/bff/admin/*`
  only ever uses the admin cookie, everything else only the member cookie.
  "User and Admin authentication must remain separate" is therefore enforced
  in two places (proxy + the backend's own subject-type checks).
* CSRF: SameSite=Strict **plus** an `Origin`/`Sec-Fetch-Site` same-origin
  check on every non-GET request.
* A non-secret random device id (`rz_device_id`, httpOnly) is generated once
  and forwarded as `X-Device-Id`, which is what the backend's new-device
  verification needs to recognise a returning device.
* No new backend behaviour; the proxy is a transport, not a second auth system.

### D2 — Route protection
Server-component layouts (`/dashboard/*`, `/admin/*`) validate the session
(`GET /users/me` / `GET /admin/ping`) before rendering and redirect to
`/login` / `/admin/login`. Client code additionally handles a mid-session 401
by redirecting. Frontend hiding is never relied upon — every action still goes
through the backend's own authorization.

### D3 — One API client
`src/lib/api/` — a single typed client for browser use plus a server helper
for layouts. Handles base URL, JSON, error envelope, 401/403/404/409/422(400)/
429/5xx/network failure, abort, and exposes a typed `ApiError`. No new
libraries.

### D4 — Identity link gap (genuine contract defect, smallest additive fix)
See **C-1** below. Additive response fields only, no schema change.

### D5 — Dev OTP visibility
See **C-2** below.

---

## 4. Classification legend

A = already fully connected · B = backend exists, frontend not connected ·
C = frontend exists, backend capability missing · D = partial ·
E = mock/static data · F = broken · G = intentionally out of scope

---

## 5. Findings — Cross-cutting backend/contract defects

These are the only places where the *backend contract itself* blocks a
working product. Each is evaluated against "can B16 fix it additively?".

### C-1 (class C/F) — A profile cannot be linked to its owner's user id (blocks interest / like / shortlist / block / chat / report from any profile card)
* **Evidence.** `AuthenticatedPublicProfileView` (`src/server/modules/profiles/profiles.dto.ts:158`) exposes `id` = **profile id** and no user id. Every interaction/chat/report API takes a **user id** (`toUserId`, `targetUserId`, `counterpartUserId`, `reportedUserId`). The reverse list views (`CounterpartRef` in `interactions.dto.ts`, chat DTO) carry `{userId, name}` and **no profile id**, so a list row cannot be linked to a photo or profile either. The code's own comment says the client should "follow up with GET /profiles/:profileId" but the profile id is not provided.
* **Effect.** A "Send interest" button on a search/recommendation card cannot be wired; interest/shortlist/chat lists can show a name but no photo/age/city.
* **Fix (smallest additive).** (a) add `userId` to `AuthenticatedPublicProfileView` — only in the *authenticated* shape (anonymous gated view unchanged, so nothing new leaks to visitors); search + recommendation items inherit it; (b) add `profileId` to `CounterpartRef` (interactions + chat). Response-only additions; no DB change; tests assert only `.counterpart.userId`, so they are unaffected.
* **Can B16 do it?** Yes. Risk: low. Re-verified by full regression.

### C-2 (class C) — A human cannot read a dev OTP on a running server
* **Evidence.** `dev.provider.ts` stores the code in an in-process `Map`; the only reader `getDevOtpCode()` is a function (used by tests). Its own header says tests "and a local developer" can drive the flow, but no route/console path exists. `otp_configs.dev_mode` defaults `false` and the three real providers throw. Result: **on a running dev server nobody can complete signup, OTP login, new-device verification or password reset by hand.**
* **Fix (additive, dev-only, zero change to B2 code).** A route in the new proxy layer, `GET /bff/dev/otp-code?identifier=…&purpose=…`, that calls the existing `getDevOtpCode()`; it returns 404 when `NODE_ENV=production` **or** when OTP `dev_mode` is off, so it is structurally absent in production (same double-guard philosophy as B2). The signup/login/reset screens show a clearly-labelled "Development mode — your code is …" helper only when that route says it is available. The code never appears in a normal API response or log (B2 invariant intact).
* **Open question verified during implementation:** Next dev can bundle route handlers separately; if the in-memory `Map` is duplicated per bundle the reader would be empty. If that happens the minimal fix is anchoring the Map on `globalThis` in `dev.provider.ts` (behaviour-identical). Recorded, not assumed.
* **Can B16 do it?** Yes.

### C-3 (class C) — `communities` lookup table is empty and unreachable
* **Evidence.** `communities` = 0 rows. The profile/preferences APIs accept only `communityId` (UUID). `findOrCreateCommunity` exists (`reference.repository.ts:174`) but **no API route calls it** (BACKEND.md §28 says "created on first use" — that path was never exposed). `GET /reference/profile-options` therefore returns **no `communities` key at all** until a religion has rows. The frontend, meanwhile, ships a 34-group community/caste dataset (`src/data/communityData.ts`).
* **Effect.** Community/caste (profile field, partner preference, search filter, and the 8-point matching weight) cannot be used.
* **Fix (data only, idempotent seed addition).** Seed the 34 groups into `communities` (name = `"<sect> › <group>"`, `religion_id` = matching religion), exactly like the other reference lists. No schema change; the UI regroups by the sect prefix. The static frontend dataset is then no longer the source of truth.
* **Can B16 do it?** Yes (seed file additive; run on dev + test DB).

### C-4 (class B/D) — `GET /admin/ping` returns role only; UI cannot show RBAC-accurate navigation
* **Fix.** Additive `permissions: string[]` in the ping response (derived from the existing role→permission tables) so the admin shell can show exactly what the signed-in admin is allowed to do. Server enforcement unchanged and authoritative.
* **Can B16 do it?** Yes.

### Defects that B16 will NOT fix (honest list — requires new backend features)
| # | Gap | Evidence | Disposition |
|---|---|---|---|
| X-1 | No admin **staff management** API (create/invite/list/disable/change role) | no `/admin/staff*` route; staff exist only via seed/DB | G — UI marked "Not available"; documented how to create a staff admin by script |
| X-2 | No admin **manual suspend** | only `lift-suspension`; suspension is automatic via report threshold | Remove the fake "Suspend" button; keep real "Lift suspension" |
| X-3 | No **feature-flag** store | no route/table | G — flags UI removed / marked unavailable |
| X-4 | No staff **operational settings** (maintenance mode, manual approval, support contact) | no route/table | G — same |
| X-5 | No member **privacy**/**notification preference** storage | no route/table | G — UI marked unavailable |
| X-6 | No **account deactivation / email-or-phone change / authenticated change-password** | no route | Change-password is delivered through the real forgot/reset OTP flow; the rest marked unavailable |
| X-7 | No **profile-view tracking** ("Profile Views 128") | no table/route | Tile removed (never fabricate numbers) |
| X-8 | No **contact-form** endpoint | no route (support tables exist, no API) | Form replaced with honest mailto/contact details |
| X-9 | No **payment webhook**, real gateways, real OTP vendors, cloud storage | documented B15/B16a limitations | NOT CONFIGURED — documented, mock/dev flows clearly labelled |
| X-10 | **Photo moderation** column exists but nothing writes it and no admin photo API | `profile_photos.moderation` is never set | Dormant (G); admin approval is *profile verification*, which does exist |
| X-11 | No **real-time** chat transport | no WebSocket/SSE | Polling over the existing paginated API; limitation documented |

---

## 6. Findings — Frontend inventory, by area

Each row: **what exists → class → exact backend API → action → completable in B16**.

### 6.1 Authentication

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| AU-1 | `components/auth/SignupFlow.tsx` | E / F | Stepper is cosmetic (`next()` just increments). UI asks for a **4-digit** code; backend OTP length is **6** (`otp_configs.otpLength`). "Profile for" has no backend field. Gender uses bride/groom (backend `MALE`/`FEMALE`). Religion/community come from a static dataset. After password the user lands on a static "ready" page without ever creating a profile | `POST /auth/register`, `/auth/verify-signup-otp`, `/auth/set-password`, `/auth/resend-otp`, then `POST /profiles/me` + `PATCH /profiles/me` | Wire all steps; 6-digit input; drop "Profile for" (no storage); map gender; create the profile right after the session is issued; lookups for religion/community | Yes |
| AU-2 | `components/auth/LoginForm.tsx`, `app/(marketing)/login/page.tsx` | E / F | Submit = `router.push("/dashboard")` with no check. Label says "Mobile number or email" but backend login is **email only**. OTP channel text read from the mock `PLATFORM_CONFIG` | `POST /auth/login`, `/auth/verify-device`, `/auth/request-login-otp`, `/auth/verify-login-otp` | Wire; handle `deviceVerificationRequired`; take the channel from the API response, not a constant | Yes |
| AU-3 | `LoginForm.tsx` link `/login/forgot-password` | F | **Page does not exist** (404) | `POST /auth/forgot-password`, `/auth/reset-password` | Build `/login/forgot-password` | Yes |
| AU-4 | `DashboardShell.tsx`, `AdminShell.tsx` | F | "Log out" is `<Link href="/">` — no session revoked | `POST /auth/logout`, `/auth/logout-all` | Real logout (+ "log out everywhere" in Settings) | Yes |
| AU-5 | `app/dashboard/layout.tsx`, `app/admin/layout.tsx` | F | No auth guard on any dashboard or admin route; anyone can open them | `GET /users/me`, `GET /admin/ping` | Server-side guards + 401 handling | Yes |
| AU-6 | `components/layout/Header.tsx` (its own comment at ~l.53) | D | Header always shows Login / Sign up, even when signed in | `GET /users/me` | Session-aware header | Yes |
| AU-7 | (absent) | B | Device id never sent → every login would trigger new-device OTP | `X-Device-Id` header | Proxy-managed device cookie (D1) | Yes |
| AU-8 | (absent) | F | **No admin login page exists**; backend `POST /admin/login` unused | `POST /admin/login` | Build `/admin/login` | Yes |

### 6.2 Profile, photos, preferences

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| PR-1 | `ProfileEditor.tsx` (Basic/About tabs), `app/dashboard/profile/page.tsx` | E | Local state; "Save Changes" only shows a green banner (`setTimeout`). Fields are free text (education, profession, mother tongue, city, country) but backend needs lookup **ids**. "Age" is editable but backend derives age from DOB. Name is edited here but the profile API has no name field | `GET/PATCH /profiles/me`, `GET /reference/profile-options` | Wire; dropdowns from lookups; DOB instead of age; name shown read-only (X: no rename API) | Yes |
| PR-2 | `ProfileEditor.tsx` | B | Backend supports income (range/currency/min/max), lifestyle, family details, multi-value mother tongue/education/profession — **no UI** | `PATCH /profiles/me` | Add compact inputs | Yes |
| PR-3 | `ProfileEditor.tsx` photos tab | E / F | Disabled "Add Photo" tile showing a mock stock URL | `GET/POST /profiles/me/photos`, `PATCH …/primary`, `PATCH …/reorder`, `DELETE …/{id}`, `GET /profiles/photos/{id}/file` | Real upload/list/primary/reorder/delete; photos shown through the proxy (cookie auth) | Yes |
| PR-4 | `dashboard/page.tsx`, `DashboardShell.tsx` | E | Profile completion % is a mock constant (72) | `GET /profiles/me/completion` | Backend is the sole source of truth; show `missingRequiredFields` | Yes |
| PR-5 | `ProfileEditor.tsx` preferences tab | E / D | Mock `partnerPreferences`; only 6 free-text fields; backend has age, **height**, gender preference, religion, marital statuses[], communities[], mother tongues[], educations[], professions[], countries[], cities[], income, notes | `GET/PATCH /profiles/me/partner-preferences` | Wire; add the missing controls (multi-selects) | Yes |
| PR-6 | (absent) | B | No page to view **another member's** profile; cards link to `#` | `GET /profiles/{profileId}` | Add `/dashboard/members/[id]` (minimal) with actions | Yes |

### 6.3 Search, recommendations, home

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| MS-1 | `app/(marketing)/search/page.tsx`, `profileService.search`, `FilterPanel.tsx` | E | Filters mock array client-side. Param names differ from backend (`ageMin`→`minAge`, `religion` name→`religionIds`, `country`/`motherTongue` names→ids). No pagination. "Sort by" offers *Best Match / Recently Active* that the backend does not have (`updatedAt`/`createdAt` only). Backend **rejects unknown query params with 400** | `GET /search/profiles` | Server-side mapping names→ids; pagination; honest sort options; works anonymously (gated cards) and signed-in | Yes |
| MS-2 | `components/home/ExploreProfiles.tsx` | F | Links to `/search?category=…`; `category` is unsupported by search (silently ignored today, would 400 on the API) | `GET /search/profiles` | Build links from real lookup ids; omit entries with no lookup | Yes |
| MS-3 | `components/home/FeaturedProfiles.tsx` | E | 4 mock profiles with stock photos | `GET /search/profiles?pageSize=4` | Real anonymous results; honest empty state when there are no members | Yes |
| MS-4 | `components/home/Hero.tsx` | D | Search widget uses static religion list; submits unsupported param names | — | Map to the same params as MS-1 | Yes |
| MS-5 | `dashboard/matches/page.tsx`, `dashboard/page.tsx` | E | `dashboardService.getMatches()` returns sorted mock data | `GET /profiles/me/recommendations` | Wire primary + secondary ("You may also like") lists, pagination, score/tier/breakdown | Yes |
| MS-6 | `components/profile/ProfileCard.tsx`, `MatchScore.tsx` | D | Card typed on the mock `Profile` (heart / Interest / Chat buttons have no handlers; "online" dot, "last active" have no backend equivalent). `gated` is a fixed per-page flag | — | Re-type on real DTOs; gating decided by the API response `audience`; drop online dot | Yes |
| MS-7 | `components/home/SmartMatchingSection.tsx` | G | Illustrative breakdown (92%) with static numbers | — | Keep, labelled as an example | n/a |

### 6.4 Interactions and chat

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| IN-1 | `InterestsView.tsx`, `app/dashboard/interests/page.tsx` | E | Mock; optimistic update then "succeeds" regardless | `GET/POST /interactions/interests`, `PATCH /interactions/interests/{id}` | Wire accept/decline/withdraw with real error handling. Sending an interest requires an **ACTIVE membership** (backend rule) — show upgrade prompt on that error | Yes (needs C-1) |
| IN-2 | `ShortlistGrid.tsx` | E | Mock | `GET/POST /interactions/shortlist`, `DELETE …/{targetUserId}` | Wire | Yes (C-1) |
| IN-3 | `ProfileCard.tsx` | B | Like heart / Interest / Chat do nothing | `POST/DELETE /interactions/likes`, `POST /interactions/interests`, `POST /chats` | Wire | Yes (C-1) |
| IN-4 | (absent) | B | Mutual **matches** have no screen | `GET /interactions/matches` | Add "Mutual matches" tab (entry point to chat) | Yes |
| IN-5 | (absent) | B | **Block / unblock / report** have no UI | `POST/GET /interactions/blocks`, `DELETE …/{id}`, `GET /reports/categories`, `POST /reports` | Actions on the member page; "Blocked members" list in Settings | Yes |
| IN-6 | (absent) | B | Member **warnings** have no UI | `GET /warnings/me`, `POST /warnings/{id}/acknowledge` | Settings section | Yes |
| CH-1 | `MessagesView.tsx`, `dashboard/messages/page.tsx` | E | Mock conversations; send appends locally | `GET/POST /chats`, `GET/POST /chats/{id}/messages`, `POST /chats/{id}/read`, `GET /chats/unread-count` | Wire; paginate; mark read; unread count in shell; show the backend's blocked / membership-expired errors; **polling** (X-11) | Yes (C-1) |

### 6.5 Membership and payments

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| MP-1 | `data/plans.ts`, `PlanCard.tsx`, `app/(marketing)/membership/page.tsx`, `components/home/MembershipPreview.tsx`, `dashboard/membership/page.tsx` | E / F | Hardcoded plans: ₹499 / ₹1,499 / ₹3,499 / ₹5,999 with USD twins. **Real plans differ**: `PLAN_7DAY_INR` ₹199, Monthly ₹999, … (price in paise, `durationDays`, `features` flags). Comparison table rows are static | `GET /membership-plans?currency=`, `GET /membership-plans/me` | Render the backend catalogue; comparison table built from real feature flags | Yes |
| MP-2 | `CheckoutClient.tsx`, `membership/checkout/page.tsx` | E / F | **Fake payment**: `setTimeout(...,1400)` then "Payment successful… verified with Razorpay". Gateway name comes from the mock config | `POST /memberships/checkout`, `POST /payments/{id}/verify`, `GET /payments/{id}` | Replace with the real checkout → verify round-trip. With no real gateway configured use the backend's own dev/test path (`devSimulateOutcome`, honoured only outside production) and label it unmistakably as a **development simulation**; in production with no gateway show an honest "payments not configured" state. Success is shown only after the backend says `SUCCESS` | Yes |
| MP-3 | `dashboard/membership/page.tsx` | E | `ACTIVE_MEMBERSHIP` hardcoded ("Monthly, renews 30 Sep 2026") | `GET /memberships/me`, `/memberships/me/history`, auto-renew endpoints | Wire; real status/expiry/benefits; auto-renew toggle | Yes |
| MP-4 | (absent; copy refers to "Settings → Invoice History") | B | No invoice / payment history UI | `GET /payments/me`, `GET /invoices/me`, `GET /invoices/{id}/download` (PDF) | Add to the membership page; PDF streamed through the proxy | Yes |

### 6.6 Notifications, dashboard, settings

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| NT-1 | `NotificationsList.tsx`, `dashboard/notifications/page.tsx`, `DashboardShell.tsx` (unread dot) | E | Mock; "mark read" local only; mock types/hrefs (`interest`, `match`…) that the backend does not return | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | Wire; render `title/body/createdAt/isRead`; **no frontend-fabricated notifications**; unread badge from the API | Yes |
| DB-1 | `dashboard/page.tsx` | E | Hardcoded tiles "New Matches this week = 6", "Profile Views = 128" | — | Replace by real counts (pending received interests, shortlist, mutual matches, unread notifications). "Profile views" has no backend → removed (X-7) | Yes |
| ST-1 | `SettingsView.tsx`, `dashboard/settings/page.tsx` | E / C | Email/phone are constants. "Update Password" shows *"Password updated successfully"* without doing anything. Privacy toggles, notification toggles and "Deactivate account" are local state only | `GET /users/me`, `POST /auth/forgot-password` + `/auth/reset-password`, `POST /auth/logout-all` | Real account details (read-only); password change via the real OTP reset flow; "Log out of all devices"; privacy / notification-preference / deactivation sections replaced by an honest "not available yet" (X-5, X-6) | Yes |

### 6.7 Public / marketing content

| ID | File(s) | Class | Finding | Action |
|---|---|---|---|---|
| MK-1 | `components/home/TrustStrip.tsx` | E | **Fabricated statistics**: "2,00,000+ Verified members", "18,500+ Successful matches", "100% Profile verification", "4.8 / 5 rating" — the platform has no members and no endpoint for these | Replace with truthful, non-numeric trust points. Never display invented numbers |
| MK-2 | `components/home/Testimonials.tsx`, `app/(marketing)/success-stories`, `data/testimonials.ts` | E / G | Illustrative couples with stock photos; headline says "Real Stories" while the body says "Illustrative" | Keep as clearly-labelled illustrative content (no CMS exists); fix the contradictory heading; flagged as a launch-content item for the owner |
| MK-3 | `blog/*`, `faq`, `about`, `how-it-works`, `safety`, legal pages | G / A | Static editorial content; no CMS/API exists or is expected | Leave as is |
| MK-4 | `app/(marketing)/contact/page.tsx` | F / C | `<form>` with no action/handler (submits as a page-reload GET) | X-8: honest contact details instead of a dead form |
| MK-5 | `data/faqs.ts`, `data/blogPosts.ts` | G | Static content | Leave |

### 6.8 Admin panel

| ID | File(s) | Class | Finding | API | Action | B16? |
|---|---|---|---|---|---|---|
| AD-1 | `AdminShell.tsx` | E / F | Hardcoded identity ("Staff Admin / admin@rishteyzindagi.com"), all nav items shown to everyone, "Log out" → `/` | `GET /admin/ping`, `POST /auth/logout` | Real identity + role + permission-aware nav (C-4); real logout | Yes |
| AD-2 | `admin/page.tsx` + `adminService.getPlatformStats` | E | Totals derived from mock arrays; **"Revenue This Month" = hardcoded 486200**; "Active Today", "New signups this week" have no backend metric | `GET /admin/dashboard`, `GET /admin/users` | Wire real stats; revenue from `revenueByCurrency`; unsupported metrics shown as "Not tracked" (never invented) | Yes |
| AD-3 | `UsersClient.tsx`, `admin/users/page.tsx` | E | Mock list; Verify/Suspend are local state | `GET /admin/users` (q, status, verificationStatus, page), `GET /admin/users/{id}`, `PATCH /admin/profiles/{profileId}/verify`, `POST /admin/users/{id}/lift-suspension`, `GET/POST /admin/users/{id}/warnings` | Wire list/search/filter/pagination/detail; verify; lift suspension; issue warnings. Remove manual "Suspend" (X-2) | Yes |
| AD-4 | `ProfileApprovalsClient.tsx` | E | Mock queue with stock photos | users with `verificationStatus=PENDING` + `GET /profiles/{id}` (admin view incl. photos) + verify | Wire; approve = `VERIFIED`, reject = `REJECTED` with notes | Yes |
| AD-5 | `ReportsClient.tsx` | E | Mock; "Mark Resolved" local only | `GET /admin/reports`, `PATCH /admin/reports/{id}` | Wire | Yes |
| AD-6 | (absent) | B | Report-category and warning-category management | `GET/POST /admin/report-categories`, `PATCH …/{id}`, `GET /admin/warning-categories` | Add category management to the Reports screen (permission-gated) | Yes |
| AD-7 | `StaffClient.tsx`, `admin/super/staff` | E / C | Invite / change role / disable — all local; **no staff API** (X-1) | — | Honest "not available" screen; documented script to create staff | Partial (UI honest only) |
| AD-8 | `PlatformSettingsClient.tsx`, `admin/super/settings` | E / D | OTP channel select and gateway select are local; feature flags have no backend (X-3) | `GET/PATCH /admin/otp/config`, `GET /admin/payment-gateways`, `POST …/{id}/activate|deactivate`, `POST …/{id}/test-connection`, `PATCH …/{id}` | Wire OTP config (exactly **one** active method, as the backend enforces) and gateway activation/test; remove flags | Yes |
| AD-9 | (absent — the instruction calls it "existing") | B | **No matching-weights UI exists** | `GET/PATCH /admin/matching/weights` | Build a small editor using the backend's validation (server decides; client only displays errors) | Yes |
| AD-10 | `admin/super/revenue/page.tsx`, `transactions` mock | E | Mock transactions/plan breakdown; "refunded" has no backend concept | `GET /admin/payments`, `GET /admin/invoices`, `GET /admin/memberships`, `POST /admin/payments/{id}/manual-activate`, `POST /admin/invoices/{id}/cancel|regenerate` | Wire lists + actions; refunds not shown (no data) | Yes |
| AD-11 | `AuditLogClient.tsx`, `admin/super/audit-log` | E | Mock (role filter only) | `GET /admin/audit-logs` | Wire with pagination + filters the API supports | Yes |
| AD-12 | `SettingsClient.tsx`, `admin/settings` | E / C | Maintenance mode / manual approval / support contact — local only (X-4) | — | "Not available" notice | n/a |
| AD-13 | `admin/super/page.tsx` | E | Counts staff/revenue/log from mocks | — | Real revenue/audit counts; staff count unavailable | Yes |

### 6.9 Cross-cutting

| ID | Class | Finding | Action |
|---|---|---|---|
| CC-1 | B | No API client; `src/services/*` are mock repositories with the right shape for a swap | New typed client; services re-implemented over it; mock `src/data/*` removed where a real API exists |
| CC-2 | A | `EmptyState` / `ErrorState` / loading primitives exist in `components/ui/States.tsx` | Reuse everywhere |
| CC-3 | D | **Documentation drift**: `API_REFERENCE.md` lists `PATCH` for `notifications/{id}/read`, `notifications/read-all`, `memberships/me/{id}/cancel-auto-renew|enable-auto-renew`, `warnings/{id}/acknowledge`; the **code exports `POST`** for those routes. (The admin OTP config path is `/admin/otp/config`, not `/admin/otp-config` as the phase instruction guessed.) | Integration follows the code; `API_REFERENCE.md` corrected in the final doc pass |
| CC-4 | G | `scripts-smoke-otp.ts` undocumented stray (B15 finding #11) | Left as is, documented |
| CC-5 | D | Seed `SEED_DEV_SUPER_ADMIN` is the only way to get an admin; no staff admin exists for RBAC testing | Documented script to create a STAFF_ADMIN for local verification |

---

## 7. Backend API coverage matrix (all 95 routes)

Legend — UI after B16: **✔ connected**, **✔(new UI)** connected with a new screen, **– not user-facing** (infrastructure / admin-only-by-design / mobile-only), **✘ unavailable**.

| Module | Routes | Today | After B16 |
|---|---|---|---|
| Auth (12) | register, verify-signup-otp, set-password, resend-otp, login, verify-device, request-login-otp, verify-login-otp, forgot-password, reset-password, logout, logout-all | none used | ✔ all 12 |
| Users | `GET /users/me` | none | ✔ |
| Profiles | `GET/POST/PATCH /profiles/me`, `GET /profiles/me/completion`, `GET /profiles/{id}` | none | ✔ |
| Photos | list/upload/primary/reorder/delete, `GET …/file` | none | ✔ |
| Preferences | `GET/PATCH …/partner-preferences` | none | ✔ |
| Reference | `GET /reference/profile-options` | none | ✔ |
| Search | `GET /search/profiles` | none | ✔ |
| Recommendations | `GET /profiles/me/recommendations` | none | ✔ |
| Interactions (interests, likes, shortlist, matches, blocks) | 13 handlers | none | ✔ (needs C-1) |
| Chat | list/open, messages get/post, read, unread-count | none | ✔ (needs C-1) |
| Notifications | list, unread-count, read, read-all | none | ✔ |
| Device push tokens | register/list/revoke | none | – (mobile/FCM; no web push vendor) |
| Membership | plans, plans/me, checkout, me, history, renew, auto-renew ×2, auto-renew-attempt, renewal-reminder-check | none | ✔ (auto-renew-attempt / reminder-check are backend-triggered housekeeping → not surfaced) |
| Payments / invoices | payments me/get/verify, invoices me/get/download/resend | none | ✔ |
| Reports / warnings | categories, create, warnings me, acknowledge | none | ✔(new UI) |
| Health | health, ready | n/a | – |
| Admin auth/ping | login, ping | none | ✔(new UI) |
| Admin dashboard/users/verify/suspension/warnings | dashboard, users, users/{id}, verify, lift-suspension, warnings ×2, warning-categories | none | ✔ |
| Admin reports | reports list/patch, report-categories ×3 | none | ✔ |
| Admin OTP / weights | otp/config get+patch, matching/weights get+patch | none | ✔(new UI for weights) |
| Admin payments | gateways ×5, payments list, manual-activate, invoices ×4, memberships list | none | ✔ |
| Admin audit | audit-logs | none | ✔ |

Frontend screens with **no** matching backend capability are listed in §5 (X-1…X-11).

---

## 8. Fake / mock data sweep (Step 17 classification)

| Occurrence | Class |
|---|---|
| `src/data/profiles.ts`, `interests.ts`, `conversations.ts`, `notifications.ts`, `currentUser.ts` | MUST CONNECT → SAFE TO REMOVE after wiring |
| `src/data/adminUsers.ts`, `pendingApprovals.ts`, `reports.ts`, `staffAccounts.ts`, `transactions.ts`, `auditLog.ts`, `platformConfig.ts` (config + `describeOtpChannel` helper) | MUST CONNECT / SAFE TO REMOVE (helper text relocated) |
| `src/data/plans.ts`, `PlanCard`, plan comparison rows | MUST CONNECT |
| `src/services/{dashboard,profile,admin,superAdmin}Service.ts` | Re-implemented over the real client |
| `CheckoutClient` `setTimeout` fake payment | MUST CONNECT (critical) |
| `SettingsView` fake "Password updated" | MUST CONNECT |
| `ProfileEditor` `setTimeout` banner | MUST CONNECT (becomes real result) |
| `TrustStrip` invented statistics | SAFE TO REMOVE / replace |
| `data/communityData.ts` | REAL reference data → becomes **seed source** (C-3); UI reads lookups from the API |
| `data/testimonials.ts`, `blogPosts.ts`, `faqs.ts` | INTENTIONAL DEMO / static editorial (no API exists) |
| `SmartMatchingSection` example breakdown | INTENTIONAL DEMO (labelled) |
| Stock-photo URLs in mock data | go away with the mock arrays |

---

## 9. Documentation vs code discrepancies found

1. `API_REFERENCE.md` HTTP methods (see CC-3) — code is authoritative.
2. `BACKEND.md` §28 says communities are "created on first use"; no API reaches that code (C-3).
3. `src/services/README.md` still lists planned modules and "Phase 2" mock behaviour — superseded by this phase.
4. Admin OTP route is `/admin/otp/config`, not `/admin/otp-config` as the instruction guessed.

---

## 10. Planned backend changes (complete list — additive only)

| # | Change | Files | Schema/migration? |
|---|---|---|---|
| BE-1 | `userId` on the authenticated public profile view | `profiles.dto.ts` (+ search/recommendation inherit) | No |
| BE-2 | `profileId` on `CounterpartRef` (interactions, chat) | `interactions.dto.ts`, `interactions.repository.ts` (name resolver), chat equivalents | No |
| BE-3 | `permissions[]` in `GET /admin/ping` | admin controller/service | No |
| BE-4 | Seed 34 community groups | `seed.ts` (+ run on dev and test DB) | **No schema change** (data only) |
| BE-5 | (conditional) anchor dev OTP `Map` on `globalThis` | `dev.provider.ts` | No |

No migration is planned. If implementation proves otherwise, §22 of the instruction applies (explain → verify → smallest additive change → migrate dev+test → full regression).

## 11. Risks

* Bundle-duplication of the dev OTP store (C-5 conditional above).
* `GET /profiles/{id}` N+1 for list rows (bounded by page size, endpoint has no rate limit) — acceptable; richer counterpart summaries are a documented follow-up.
* In-memory rate limiting means all browser traffic through the proxy shares one server IP unless `X-Forwarded-For` is forwarded — the proxy forwards the real client address.
* The suite takes ~7–10 minutes; full regression runs are batched.

---

## 12. Post-integration addendum (final state of this audit)

This section records what actually happened to every planned item in §10 and every B–F finding in §5–§8, after the integration was built and verified over real HTTP (see `B16_FINAL_REPORT.md` for evidence).

### 12.1 Backend changes actually made (all additive, no schema change, no migration)

| # | Planned | Final | Files |
|---|---|---|---|
| BE-1 | `userId` on authenticated public profile view | **Done** (anonymous view unchanged — verified it never carries `userId`) | `profiles.dto.ts` |
| BE-2 | `profileId` on interaction/chat counterparts | **Done** (`profileId: string \| null`) | `interactions.dto.ts`, `interactions.repository.ts`, `chat.dto.ts` |
| BE-3 | `permissions[]` in `/admin/ping` | **Changed:** `rbac.test.ts:119` asserts the exact `/admin/ping` body, so `ping` was left untouched and a **new `GET /admin/me`** route returns `{admin:{id,name,email,role}, permissions:[…]}` instead | `admin.service.ts`, `admin.controller.ts`, new `src/app/api/v1/admin/me/route.ts` |
| BE-4 | Seed 34 community groups | **Done** — data only, idempotent; dataset moved to `src/server/db/reference-data/communities.ts` | `seed.ts`, new `reference-data/communities.ts` |
| BE-5 | Anchor dev OTP `Map` on `globalThis` | **Done** — confirmed necessary (the dev bundler gave the reader and the sender separate Maps) | `otp/providers/dev.provider.ts` |
| BE-6 *(found during verification)* | Anchor the dev payment order `Map` on `globalThis` | **Done** — same root cause as BE-5: in `next dev`, checkout and verify routes had separate Maps, so a dev checkout was verified as `FAILED` | `payments/providers/dev.provider.ts` |

Diff against the pre-B16b baseline (backend side): exactly these 9 existing backend files changed + 2 new files; `drizzle/`, `package.json`, `package-lock.json`, `src/middleware.ts` and every pre-existing test file are byte-identical. One new test file (`tests/b16-integration.test.ts`, 10 tests) covers the additions.

**One configuration file also changed, disclosed here:** `next.config.js` gained a `headers()` block (BE-7, below). It is not business logic, but it is not byte-identical to the baseline.

### 12.2 Classification of every area after integration

| Area | Before | After | Notes |
|---|---|---|---|
| Signup / OTP / password / session | B/E | **A** | Real; dev-mode OTP only (no vendor) |
| Login, new-device verification, OTP login, forgot/reset, logout, logout-all | B/E | **A** | Verified incl. old-session revocation |
| Profile (all sections), completion, status | E | **A** | Completion only from backend |
| Photos (upload/primary/reorder/delete) | E | **A** | Served via `/bff`, cookie-gated |
| Partner preferences | E | **A** | Every backend-supported control |
| Search, recommendations (primary/secondary), pagination | E | **A** | Backend authoritative |
| Interest / like / shortlist / block / report / matches | E | **A** | Real success and real failure messages |
| Chat | E | **A (polling)** | No WebSocket exists — refreshes every few seconds; documented |
| Membership, plans, checkout, verify, invoices, history | E | **A (dev gateway)** | Real gateway not configured — see FINAL_HANDOVER §21 |
| Notifications | E | **A** | |
| Admin login, shell, RBAC-aware nav | C/E | **A** | Separate admin cookie |
| Admin overview, users, verification, reports, categories, OTP config, matching weights, gateways, revenue, audit log | E | **A** | |
| Admin staff & roles management | E | **G** (honestly "not available yet") | No backend API exists |
| Admin feature flags, staff-scoped settings, "Suspend" button | E | **Removed / G** | No backend API exists |
| Member privacy/notification toggles, account deactivation, e-mail/mobile change, "Profile views" | E | **G** ("Not available yet") | No backend API exists |
| Blog, FAQ, sample success stories | E | **Intentional static content** | Testimonials are labelled "sample" on every page |

### 12.3 Defects found while verifying (all fixed)

1. `SessionProvider` read `/users/me` as a bare user; the backend returns `{ user }`. Fixed.
2. Dev payment store split across route bundles (BE-6).
3. Two real 375 px overflows (success-stories grid, dashboard loading skeleton). Fixed.
4. `/success-stories` still claimed "Real couples" for sample content. Reworded as sample content.
5. **BE-7 / security headers:** the production probe showed that the website's HTML pages carried **no** security headers — the B10 middleware only covers `/api/:path*`. Added `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (and `Strict-Transport-Security` in production only) for every non-API route via `headers()` in `next.config.js`. Verified on the final production build for `/login`, `/dashboard`, `/admin/login`; `/api/*` keeps exactly the middleware's headers (no duplication). **A Content-Security-Policy is not set** — it needs a nonce strategy for Next's inline scripts and is a documented follow-up.

### 12.4 Remaining honest gaps (none blocks local use)

See `FINAL_HANDOVER.md` §24–25 and `B16_RELEASE_READINESS.md`.
