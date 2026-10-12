# B18 — Implementation audit (written before B18 code)

Baseline: the verified `RishteyZindagi_PCP_FINAL` tree (120 API routes, 43 pages, 57 tables, 646 tests). Every row below was checked in source, not taken from a document. Owner decisions recorded for this phase:

* **Entitlements:** enforce **advanced search only**. Shortlist and interests stay open to every member; the plan bullets that promise them are re-worded so they no longer imply a paywall.
* **OTP-not-required scope:** (1) new-device login verification, (2) signup contact verification. Password reset, account recovery, OTP-only login and admin login are **never** eligible.

## A. Findings (what is incomplete, disconnected or only documented)

| # | Area | Finding (evidence) | Disposition |
|---|---|---|---|
| A1 | OTP policy | Only provider choice exists (`otp-provider.service.ts`). No required/not-required policy; `login()` always sends a NEW_DEVICE OTP, `register()` always sends a SIGNUP OTP. | **BUILD** (batch 1) |
| A2 | Search — profile ID | `profiles` has only a UUID `id`. No human-usable profile ID, no lookup. | **BUILD**: `profiles.public_id` (`RZ`+8 digits, unique, backfilled) and `profileId` search filter |
| A3 | Search — entitlements | `membership_plans.features.advancedSearch` is display text; `GET /search/profiles` accepts every filter from everyone (anonymous included). | **BUILD**: server-side gate, 403 `AUTHORIZATION_ERROR` with `details.entitlement = "advancedSearch"` and a plain message; UI shows locked filters with an upgrade link |
| A4 | Search — validation | Backend validation is thorough (strict zod, id existence checks). Frontend `searchFilters.ts` builds queries without range checks; duplicate-request/stale-response handling and API failure state need checking in `SearchClient`. Page size cap is hard-coded. | **FIX** (client range validation, abort previous request); page-size cap becomes a Super-Admin setting |
| A5 | Admin user search | `q` uses unescaped `ILIKE` (a `%` or `_` in the box acts as a wildcard); no search by user id / profile ID; no membership or open-report filter; fixed sort. | **FIX/BUILD** |
| A6 | Membership plans | No admin API or screen (P2-3). The seed overwrites names/prices/features on every run. | **BUILD** (`/admin/membership-plans`, `plans.manage`, screen); seed no longer overwrites existing plans |
| A7 | Community management | `communities` is a reference table with seed data only; no admin API/UI. (A "community" in this product is a caste/community lookup, not a social group; there are no community feeds or groups.) | **BUILD** admin list/add/rename/deactivate for the lookup; **document** that social groups do not exist |
| A8 | Security events | `login_attempts` and audit rows exist; no admin view. | **BUILD** `/admin/security-events` (`audit.view`) + screen |
| A9 | Payments operations | Payments list/manual verify/refund exist; no way to run reconciliation from the panel; failed-only view is only a status filter. | **BUILD** "Run reconciliation" action (`payments.review`), job-backed; keep filter |
| A10 | Platform settings | `SettingsClient` / `PlatformSettingsClient` show "operational switches" and "feature flags" as not available. | **BUILD** minimal real store (`platform_settings`): signups open/closed, search limits. Maintenance mode, manual-approval toggle, support details: **remain unavailable** and are documented |
| A11 | Staff Admin permissions | Backend permission checks are per request (`requirePermission`), sessions are revoked on disable/role change. Nav is permission-filtered, but several pages are reachable by URL and show raw 403; no consolidated matrix; role/permission list lacks keys for the new features. | **FIX**: new permissions, page-level guards with clear "needs permission" states, permission matrix test over every admin route |
| A12 | Super Admin protection | `staff.service.ts` blocks creating/editing `SUPER_ADMIN`, self role change and self-disable; role permission edits Super-only. Needs regression coverage for the new routes (plans, communities, OTP policy, settings). | **TEST** |
| A13 | Member — privacy controls | `SettingsView` lists "Privacy controls" as not available. | **BUILD**: profile visibility (visible/hidden), photo visibility (members / only people I accepted), hide last-active; enforced in search, recommendations, profile and photo routes |
| A14 | Member — notification preferences | Listed as not available. | **BUILD**: per-channel preferences for non-essential notifications (e-mail/push/WhatsApp); in-app and transactional (payment, security) notices are always sent |
| A15 | Member — session management | Only logout / logout-all. | **BUILD**: list devices/sessions, revoke one |
| A16 | Member — change email/mobile | Listed as not available. Needs verification of the new address. | **NOT BUILT** (documented; out of the brief's explicit list) |
| A17 | Stale UI text | Gateway panel says gateways are "not wired to the vendors' live APIs" (no longer true); plan bullets promise shortlist/unlimited interests. | **FIX** wording |
| A18 | Success stories / testimonials | Static labelled samples (no backend feature). | **KEEP**, already labelled |
| A19 | Contact page | "Direct contact channels are coming soon." No invented details. | **KEEP** (honest) |
| A20 | Manual membership grant | Deliberately absent (`RevenueClient`). | **KEEP** (financial safeguard, documented) |
| A21 | Dashboard charts | Totals only. | **KEEP** (documented; no time-series endpoint) |
| A22 | Chat | Polling, no WebSocket. | **KEEP** (documented) |

## B. Implementation order

1. Migration `0012` (`platform_settings`, `profiles.public_id`, privacy columns, notification prefs, `communities.is_active`) and new permissions.
2. OTP policy (service, admin API, screen, enforcement in `register`/`login`, tests).
3. Search (profile ID, entitlements, settings, client validation) and admin user search.
4. Super Admin: plans, communities, security events, reconciliation, platform settings screens.
5. Staff permission model: guards, matrix, session invalidation tests.
6. Member: privacy, notification preferences, sessions.
7. Full regression, smoke (HTTP + browser, both OTP modes), docs, versioned ZIP.

Each batch ends with `tsc` and the affected tests; the full suite runs at the end of batches 3 and 6 and again for release.


## C. Final status per finding (closed at release)

Evidence = automated test file / smoke check id; see `B18_FINAL_REPORT.md` for the run results.

| # | Status | Evidence |
|---|---|---|
| A1 | DONE | `b18-otp-policy.test.ts`, smoke `b18` O/L checks, browser L1–L4, G1–G4 (both OTP configurations) |
| A2 | DONE | `b18-search.test.ts` (profile-ID search, privacy-safe), browser card shows `ID RZ…` |
| A3 | DONE | `b18-search.test.ts` (anonymous / free / paid), smoke `b18` |
| A4 | DONE | `b18-search.test.ts`, search client validation; browser smoke (existing `smoke:ui`) |
| A5 | DONE | `b18-search.test.ts` (wildcard escaping, id/profile-ID lookup, filters) |
| A6 | DONE | `b18-plans.test.ts`, browser P1 |
| A7 | DONE | `b18-communities.test.ts`, browser P2 |
| A8 | DONE | `b18-security-events.test.ts`, browser P3 |
| A9 | DONE (mock gateways) | `b18-reconcile.test.ts`; real PhonePe/Razorpay reconciliation NOT VERIFIED (needs live credentials) |
| A10 | PARTIAL — documented | Sign-up open/closed + search limits built and tested; maintenance mode / manual-approval toggle NOT BUILT (`B18_KNOWN_LIMITATIONS.md`) |
| A11 | DONE | `b18-permission-matrix.test.ts` (67 rules), `b18-escalation.test.ts`, page guards; browser T0–T4. The browser check also found and fixed a real defect: a staff account on a **custom role** was bounced back to the login page because `GET /admin/me` refused custom role names (now any admin principal may read its own identity; regression test `[custom-role-me]`) |
| A12 | DONE | `b18-escalation.test.ts` |
| A13 | DONE | `b18-member-settings.test.ts`, browser S1–S7 |
| A14 | DONE | `b18-member-settings.test.ts`, browser S5 |
| A15 | DONE | `b18-member-settings.test.ts`, browser D1–D2 |
| A16 | NOT BUILT | documented limitation |
| A17 | DONE | wording changed (gateway panel, plan bullets) |
| A18–A22 | KEPT, documented | `B18_KNOWN_LIMITATIONS.md` |
