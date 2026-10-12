# B18 — Pending Features Completion & Full Admin Integration — Final report

Environment: PostgreSQL 16 (local), Node 22, Next.js 14.2.35, Chromium (Playwright) for browser checks. Every third party (Razorpay, PhonePe, Fast2SMS, SMTP, storage) was a **local mock**. Nothing was verified against a real vendor.

Baseline: verified `RishteyZindagi_PCP_FINAL` (120 API routes, 43 pages, 57 tables, 646 tests; preserved unchanged, sha256 `f1737cb0…7af04`). Result: **133 API routes, 46 pages, 58 tables, 13 migrations, 75 test files / 716 tests**.

## 1. Owner decisions applied

* Entitlements: **advanced search only** is gated by plan; shortlist and interests stay open to every member.
* OTP-not-required scope: **new-device login** and **sign-up verification** only. Password reset, account recovery, OTP-only login, admin login and payments can never be made OTP-less.

## 2. Feature result table (PASS / FAIL / NOT VERIFIED)

PASS = automated test and/or real-HTTP / browser check run in this phase against local mocks. No row is FAIL. NOT VERIFIED rows need real credentials; NOT BUILT rows are listed in section 6, not claimed.

| # | Feature | Result | Evidence |
|---|---|---|---|
| 1 | OTP policy (required / not required) for new-device login and sign-up, Super Admin only, audited with reason, safe default | PASS | `b18-otp-policy` (16 tests); HTTP smoke; browser O1–O3, L1–L4, G1–G4 — **both configurations exercised** |
| 2 | OTP-less never bypasses password, account status, sessions, or the sensitive flows | PASS | `b18-otp-policy` `[sensitive-always-otp]`, `[device-not-required-boundaries]`; browser L3 |
| 3 | Policy independent from the single active provider (EMAIL or SMS) | PASS (mock providers) | `[policy-vs-provider]` |
| 4 | Real Fast2SMS / SMTP delivery of codes | NOT VERIFIED | needs live credentials |
| 5 | Profile-ID search, sort, pagination, filters, wildcard-safe text | PASS | `b18-search` (13) |
| 6 | Advanced search entitlement enforced server-side; UI shows the upgrade state | PASS | `[adv-gate]`, `[adv-allowed]`, `[adv-switch]`, `[access-hint]`; HTTP smoke |
| 7 | Search never leaks private data (hidden profiles, photo visibility, last active) | PASS | `[pid-hidden]`, `b18-member-settings` `[ms-hidden-everywhere]`, `[ms-photos-accepted-only]` |
| 8 | Admin user/member search + status/membership/open-report filters, id and profile-ID lookup | PASS | `[admin-search-*]` |
| 9 | Membership plans management (screen + API) | PASS | `b18-plans` (4); browser P1 |
| 10 | Community management | PASS | `b18-communities` (4); browser P2 |
| 11 | Security events view | PASS | `b18-security-events` (4); browser P3 |
| 12 | Payment reconciliation action | PASS (mock gateways) / real gateways NOT VERIFIED | `b18-reconcile` (3) |
| 13 | Platform settings: sign-ups open/closed, search limits | PASS | `[signup-closed]`, `[page-size-settings]`, `[settings-authz-validation]` |
| 14 | Staff Admin permissions enforced on every backend request (67 rules), immediate effect | PASS | `b18-permission-matrix` (5), `B18_PERMISSION_MATRIX.md`; browser T4 |
| 15 | No privilege escalation; session invalidation on role change / disable / password reset | PASS | `b18-escalation` (8) |
| 16 | Staff Admin on a custom role can use the panel | PASS — **defect found by the browser check and fixed** (see §5) | `[custom-role-me]`; browser T0 |
| 17 | Panel pages reached by URL show a clear permission screen; no dead controls | PASS | browser T1–T3; dead-control scan |
| 18 | Member privacy controls | PASS | `b18-member-settings` (13); browser S1–S7 |
| 19 | Member notification preferences | PASS (settings saved and honoured; only e-mail sends exist today) | `[ms-notif-prefs]`, `[ms-notif-isolation]` |
| 20 | Member device sessions: list and revoke | PASS | `[ms-sessions-*]`; browser D1–D2 |
| 21 | Razorpay / PhonePe live payments, webhooks from the vendor | NOT VERIFIED | local mock gateway smoke only (52/52, 35/35) |
| 22 | Change e-mail / mobile, admin MFA, recurring billing, maintenance mode, manual approval toggle, e-mail digests, social groups, CMS success stories, websocket chat | NOT BUILT | §6 |

## 3. Verification run

**Automated tests (real PostgreSQL): 75 files / 716 tests passed, 0 failed** (pass 4 of 4 full runs, 865 s; the earlier three passes surfaced the three issues described in §5 and `B18_KNOWN_LIMITATIONS.md`; B18 added 9 files / 70 tests: otp-policy 16, member-settings 13, search 13, escalation 8, permission-matrix 5, plans 4, communities 4, security-events 4, reconcile 3).

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | compiled successfully (133 API routes, 46 pages) |
| `npm run smoke:prod` (fresh empty DB, 13 migrations, seed, mock SMTP/STARTTLS, production server) | **123/123** |
| `npm run smoke:gateway` (mock Razorpay, PhonePe, Fast2SMS) | **52/52** |
| `npm run smoke:b18` (HTTP; OTP required **and** not required; unauthorized direct API, member/Staff/Super boundaries, sessions) | **114/114** |
| `npm run smoke:ui` / `smoke:ui-gateway` (Chromium) | **42/42** / **35/35** |
| `npm run smoke:b18-ui` (Chromium: member, Super Admin, Staff Admin; both OTP configurations; CSP violations and horizontal overflow checked) | **42/42** |
| Server logs of every smoke | 0 stack traces / secrets |

## 4. Migrations

`drizzle/0012_b18_admin_controls.sql` (additive; backfills `profiles.public_id`): `platform_settings` table; `communities.is_active`; `profiles.public_id` (+ sequence), `profile_visibility`, `photo_visibility`, `show_last_active`; `users.notification_preferences`; permissions `plans.manage`, `communities.manage` (granted to SUPER_ADMIN); removes the paywall-implying `unlimitedInterests` / `shortlist` plan feature keys. Applied to a fresh empty database (58 tables) by every smoke run, and to the local dev database.

## 5. Defects found during verification and fixed

* **Custom-role staff were bounced to the login page.** `GET /admin/me` required the role name `SUPER_ADMIN` or `STAFF_ADMIN`, so an account on any other role (for example an audit-only role created by a Super Admin) could sign in but never open the panel. Found by the first browser run (check T2 failed; T1 had passed vacuously, so the check was tightened with T0). Fixed in `admin.service.ts` (any signed-in admin may read its own identity and permission keys; members still cannot); regression test `[custom-role-me]`.
* **Intermittent deadlock when two admins switch the active payment gateway at once.** `[cfg-concurrent-switch]` failed once in the second full run (one PATCH returned 500: Postgres aborted a deadlocked `UPDATE payment_gateways`). A latent PCP-era race, not caused by B18. `gateways.repository.ts::setActiveGateway` now takes a transaction-scoped advisory lock so concurrent switches queue and the result is always exactly one active gateway. `pcp-payments` re-run green (3×) after the fix.
* A test-ordering hazard (`otp_configs` wiped by `TRUNCATE admin_users … CASCADE`) made `performance-pagination-stability` fail depending on file order; `resetAdminUsers()` now re-creates the singleton. Test helper only, no product code.

## 6. Remaining limitations (honest)

See `B18_KNOWN_LIMITATIONS.md` and `PCP_KNOWN_LIMITATIONS.md`. In short: every third-party integration is mock-tested only; `plans.manage` / `communities.manage` can be delegated at the API but their screens are Super Admin only; notification preferences only affect e-mail today; not built: change e-mail/mobile, admin MFA, recurring billing, maintenance mode, manual-approval toggle, e-mail digests, support-contact store, social community groups, CMS success stories, WebSocket chat.

Frozen-module edits (each needed for a B18 requirement or defect, none a rewrite): `schema.ts`, `seed.ts` (no longer overwrites existing plans), `auth.service.ts`, `otp.service.ts`, `profiles.service/dto`, `reference.repository`, search / membership / recommendation / interaction services, notifications, `invoices.service`, `authenticate.ts` (records last-active), `errors.ts`, `rate-limit-policy.ts`, `payments/gateways.repository.ts` (advisory lock), and tests `db.test.ts` (58 tables), `search-profiles` / `qa-boundary-conditions` (disable the advanced-search gate for filter-mechanics tests), `pcp-security` (route allow-list), `reset-db` helper.

## 7. Files changed

### Source (`src/`)
- `src/app/admin/(panel)/account-deletions/page.tsx` — modified
- `src/app/admin/(panel)/page.tsx` — modified
- `src/app/admin/(panel)/profiles/page.tsx` — modified
- `src/app/admin/(panel)/reports/page.tsx` — modified
- `src/app/admin/(panel)/users/page.tsx` — modified
- `src/components/admin/AdminShell.tsx` — modified
- `src/components/admin/PlatformSettingsClient.tsx` — modified
- `src/components/admin/RevenueClient.tsx` — modified
- `src/components/admin/SettingsClient.tsx` — modified
- `src/components/admin/SettingsPanels.tsx` — modified
- `src/components/admin/UsersClient.tsx` — modified
- `src/components/admin/adminTypes.ts` — modified
- `src/components/auth/SignupFlow.tsx` — modified
- `src/components/dashboard/SettingsView.tsx` — modified
- `src/components/dashboard/member/MemberProfileView.tsx` — modified
- `src/components/dashboard/profile/StatusPanel.tsx` — modified
- `src/components/home/AppPromotion.tsx` — modified
- `src/components/membership/planUtils.ts` — modified
- `src/components/profile/ProfileCard.tsx` — modified
- `src/components/profile/cardModel.ts` — modified
- `src/components/search/FilterPanel.tsx` — modified
- `src/components/search/SearchClient.tsx` — modified
- `src/components/search/searchFilters.ts` — modified
- `src/lib/api/types.ts` — modified
- `src/server/db/schema.ts` — modified
- `src/server/db/seed.ts` — modified
- `src/server/lib/errors.ts` — modified
- `src/server/middleware/authenticate.ts` — modified
- `src/server/middleware/rate-limit-policy.ts` — modified
- `src/server/modules/admin/admin.service.ts` — modified
- `src/server/modules/admin/users-admin.controller.ts` — modified
- `src/server/modules/admin/users-admin.dto.ts` — modified
- `src/server/modules/admin/users-admin.repository.ts` — modified
- `src/server/modules/admin/users-admin.service.ts` — modified
- `src/server/modules/auth/auth.service.ts` — modified
- `src/server/modules/interactions/interactions.repository.ts` — modified
- `src/server/modules/interactions/interactions.service.ts` — modified
- `src/server/modules/invoices/invoices.service.ts` — modified
- `src/server/modules/memberships/membership-gate.ts` — modified
- `src/server/modules/memberships/membership-plans.service.ts` — modified
- `src/server/modules/memberships/memberships.service.ts` — modified
- `src/server/modules/notifications/notifications.repository.ts` — modified
- `src/server/modules/notifications/notifications.service.ts` — modified
- `src/server/modules/otp/otp.service.ts` — modified
- `src/server/modules/payments/gateways.repository.ts` — modified
- `src/server/modules/profiles/profiles.dto.ts` — modified
- `src/server/modules/profiles/profiles.service.ts` — modified
- `src/server/modules/profiles/reference.repository.ts` — modified
- `src/server/modules/recommendations/recommendations.repository.ts` — modified
- `src/server/modules/recommendations/recommendations.service.ts` — modified
- `src/server/modules/search/search.controller.ts` — modified
- `src/server/modules/search/search.repository.ts` — modified
- `src/server/modules/search/search.service.ts` — modified
- `src/app/admin/(panel)/super/communities/page.tsx` — new
- `src/app/admin/(panel)/super/membership-plans/page.tsx` — new
- `src/app/admin/(panel)/super/security-events/page.tsx` — new
- `src/app/api/v1/admin/communities/[communityId]/route.ts` — new
- `src/app/api/v1/admin/communities/route.ts` — new
- `src/app/api/v1/admin/membership-plans/[planId]/route.ts` — new
- `src/app/api/v1/admin/membership-plans/route.ts` — new
- `src/app/api/v1/admin/otp/policy/route.ts` — new
- `src/app/api/v1/admin/payments/reconcile/route.ts` — new
- `src/app/api/v1/admin/platform-settings/route.ts` — new
- `src/app/api/v1/admin/security-events/route.ts` — new
- `src/app/api/v1/search/access/route.ts` — new
- `src/app/api/v1/users/me/notification-preferences/route.ts` — new
- `src/app/api/v1/users/me/privacy/route.ts` — new
- `src/app/api/v1/users/me/sessions/[sessionId]/route.ts` — new
- `src/app/api/v1/users/me/sessions/route.ts` — new
- `src/components/admin/CommunitiesClient.tsx` — new
- `src/components/admin/OtpPolicyPanel.tsx` — new
- `src/components/admin/PermissionGate.tsx` — new
- `src/components/admin/PlansClient.tsx` — new
- `src/components/admin/ReconcilePanel.tsx` — new
- `src/components/admin/SearchSignupSettingsPanel.tsx` — new
- `src/components/admin/SecurityEventsClient.tsx` — new
- `src/lib/api/b18-types.ts` — new
- `src/server/modules/account/member-settings.controller.ts` — new
- `src/server/modules/account/member-settings.service.ts` — new
- `src/server/modules/admin/communities-admin.controller.ts` — new
- `src/server/modules/admin/communities-admin.service.ts` — new
- `src/server/modules/admin/plans-admin.controller.ts` — new
- `src/server/modules/admin/plans-admin.service.ts` — new
- `src/server/modules/admin/reconcile-admin.controller.ts` — new
- `src/server/modules/admin/reconcile-admin.service.ts` — new
- `src/server/modules/admin/security-events.controller.ts` — new
- `src/server/modules/admin/security-events.service.ts` — new
- `src/server/modules/platform-settings/platform-settings.controller.ts` — new
- `src/server/modules/platform-settings/platform-settings.repository.ts` — new
- `src/server/modules/platform-settings/platform-settings.service.ts` — new
- `src/server/modules/profiles/privacy.ts` — new

### Tests
- `tests/db.test.ts` — modified
- `tests/helpers/reset-db.ts` — modified
- `tests/pcp-security.test.ts` — modified
- `tests/qa-boundary-conditions.test.ts` — modified
- `tests/search-profiles.test.ts` — modified
- `tests/b18-communities.test.ts` — new
- `tests/b18-escalation.test.ts` — new
- `tests/b18-member-settings.test.ts` — new
- `tests/b18-otp-policy.test.ts` — new
- `tests/b18-permission-matrix.test.ts` — new
- `tests/b18-plans.test.ts` — new
- `tests/b18-reconcile.test.ts` — new
- `tests/b18-search.test.ts` — new
- `tests/b18-security-events.test.ts` — new

### Scripts / migrations
- `scripts/smoke/run-smoke.sh` — modified
- `drizzle/meta/_journal.json` — modified
- `scripts/smoke/b18-smoke.ts` — new
- `scripts/smoke/b18-ui-check.ts` — new
- `drizzle/0012_b18_admin_controls.sql` — new
- `drizzle/meta/0012_snapshot.json` — new

### Documentation / config
- `API_REFERENCE.md` — modified
- `BACKEND.md` — modified
- `DEPLOYMENT_PRODUCTION.md` — modified
- `FINAL_HANDOVER.md` — modified
- `LOCAL_SETUP.md` — modified
- `PCP_KNOWN_LIMITATIONS.md` — modified
- `PRODUCTION_ENV_REFERENCE.md` — modified
- `README.md` — modified
- `package.json` — modified
- `B18_AUDIT.md` — new
- `B18_KNOWN_LIMITATIONS.md` — new
- `B18_PERMISSION_MATRIX.md` — new
- `B18_RELEASE_READINESS_MATRIX.md` — new
- `B18_FINAL_REPORT.md` — new

## 8. Deliverable

Archive: `RishteyZindagi_B18_FINAL.zip` with `RishteyZindagi_B18_FINAL.zip.sha256` and `RishteyZindagi_B18_FINAL.EXPORT_VERIFICATION.txt` (clean-export procedure and results; the archive's own SHA-256 cannot be written inside the archive, so it is in the `.sha256` file and in the delivery message). `RishteyZindagi_PCP_FINAL.zip` (sha256 `f1737cb000afe195e689c335d39b24928129128af511a7f091effc2e66e7af04`) is untouched.
