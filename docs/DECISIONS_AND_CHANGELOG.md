# Decisions and Changelog

Two parts: **(A)** findings and open decisions waiting for the owner, and **(B)** a log of documentation and audit work. Older phase history (B1–B19, PCP) lives in `BACKEND.md`, `docs/phase-status/` and the `B*_FINAL_REPORT.md` files; this file does not repeat it.

## A. Open decisions and findings (none acted on)

Evidence levels:

* **Confirmed:** read in code *and* asserted by an existing test, or reproduced from code with no ambiguity.
* **From code:** read in code; no test covers it either way.
* **Business:** works as written; the question is whether it is what the business wants.

| ID | Finding | Evidence | Level | Suggested direction (needs approval) |
|---|---|---|---|---|
| D-1 | **Member is signed out when they mistype their password (or code) while changing e-mail or mobile.** `contact-change.service.ts` throws `AuthenticationError` (401) for a wrong password. The BFF clears the session cookie on any 401 from an authenticated call, and the browser client's 401 handler redirects to login. Account deletion and the admin password change deliberately use 403 to avoid exactly this. | `src/server/modules/account/contact-change.service.ts:69`; `src/app/bff/[...path]/route.ts:172`; `src/lib/api/client.ts:47`; contrast `account-deletion.service.ts:81`, `staff.service.ts` `changeMyPassword`. The test asserts 401: `tests/b19-contact-change.test.ts:39`, `:50`. | Confirmed | **Fixed 2026-10-18 (not yet committed):** wrong password and wrong/mismatched code now return 403; UI messages and test updated. |
| D-2 | **Admin protection defaults are weak for production.** Admin MFA (e-mail code) is off by default. Admin sessions use the same lifetime as members, 720 hours (30 days). | `platform-settings.service.ts:390` (`mfaRequired: false`); `src/server/config/env.ts:16` (`SESSION_TTL_HOURS` default 720), used by `admin.service.ts` `openAdminSession`. | From code | Turn MFA on before launch (needs working SMTP). Consider a shorter admin session TTL. |
| D-3 | **Documentation and code disagree on interests.** Sending a new interest requires an active (paid) membership. `B18_FINAL_REPORT.md` says interests "stay open to every member". | `src/server/modules/interactions/interactions.service.ts:180`; test `[interest-requires-membership]` in `tests/interactions.test.ts:110`; doc `B18_FINAL_REPORT.md:9`. | Confirmed | Owner decides which is intended, then fix either the code or the document. |
| D-4 | **Staff Admins see revenue.** Dashboard totals and 7–90 day trends, including revenue by currency, are gated by `users.view`, which `STAFF_ADMIN` receives by default. | `src/server/modules/admin/dashboard.service.ts:13`; `src/server/db/seed.ts:83`. | Business | If revenue should be Super-Admin-only, gate it behind `payments.review` or a new permission. |
| D-5 | **Invoices are not GST-ready.** Invoice numbers are timestamps (`RZ-YYYYMMDD-HHMMSS-mmm`), not a consecutive series per financial year. GST is a single 18% placeholder line for INR (0% otherwise), with no CGST/SGST/IGST split and no seller GSTIN. | `src/server/modules/invoices/invoice-number.ts`; `src/server/modules/invoices/tax-config.ts`. Both files document the placeholder honestly. | Business | Get a chartered accountant's requirements before going live with real money. |
| D-6 | **Paid-but-not-activated gap.** `verifyPaymentInternal` commits the payment as SUCCESS, and only then runs membership activation (its own transaction) and invoice issue. If either throws, the payment stays SUCCESS with the membership still PENDING, and later verify calls return `ALREADY_RESOLVED`. The `payment-reconcile` job checks only PENDING payments and late captures on FAILED ones. The file's header says activation happens "inside one DB transaction"; the code does not match that. | `src/server/modules/payments/payments.service.ts:386-388`, `:218-249`; `src/server/jobs/definitions/payments.ts:13-14`. | From code (no test of the failure path) | Wrap status change, activation and invoice in one transaction, or add a repair step to the reconcile job. Write a failing test first. |
| D-7 | **NRI coverage gaps.** SMS OTP (Fast2SMS) accepts only Indian 10-digit numbers, so mobile verification and mobile contact-change fail for non-Indian numbers (e-mail OTP still works). Checkout currency is USD only for AE/SA/QA/KW; members in the US, UK, Canada, Australia and everywhere else pay INR. | `src/server/modules/otp/providers/destination.ts` (`toIndianMobile`); `src/server/modules/memberships/region.ts:36`. | Business | Decide the supported NRI markets, then add an international SMS provider and currency rules. |
| D-8 | **Photo moderation is not enforced.** `profile_photos.moderation` defaults to `PENDING` and is returned in the API, but no query filters on it, so photos are visible as soon as they're uploaded. | `src/server/db/schema.ts:473`; only referenced in `profiles.dto.ts`. | From code | Decide whether photos need approval; if so, filter on it and add an admin queue. |
| D-9 | **Re-seeding re-grants Staff permissions.** `npm run db:seed` inserts the four default `STAFF_ADMIN` permissions on every run (`onConflictDoNothing`), so a permission a Super Admin removed from Staff comes back after a re-seed. | `src/server/db/seed.ts:83`, `:557`. | From code | Only grant defaults when the role is first created. |
| D-10 | **Superseded files in the working folder.** `COMMIT_1.txt`, `COMMIT_2.txt`, `PROPOSED_COMMITS.md` (written when there was no Git repository), `post-b19-audit.patch` (already in `HEAD`) and `gate1/` (15 of 16 files already in the tree). The remaining Gate 1 difference is the photo `Cache-Control` header (see `PERFORMANCE_ROADMAP.md` P-2). | `git status`; byte comparison recorded in `FILE_AUDIT_CHECKLIST.md`. | Confirmed | Owner decides whether to archive them outside the repo. Nothing was deleted. |

### Smaller items (no decision needed yet)

| ID | Item | Evidence |
|---|---|---|
| S-1 | Auth and admin controllers use the raw `X-Forwarded-For` header string as the IP for their in-process rate limits and for stored session IPs, instead of `getClientIp()` (which honours `TRUST_PROXY_HOPS`). The shared policy limiter does use `getClientIp()`. | `auth.controller.ts:21`, `admin.controller.ts` `adminLoginHandler` |
| S-2 | No per-account lockout after repeated wrong passwords. Only per-IP limits exist (10/min in-process plus 30/min shared policy). | `auth.controller.ts:120`, `rate-limit-policy.ts` |
| S-3 | Admin login does not run bcrypt against a dummy hash when the e-mail is unknown, unlike member login, so response time can reveal which admin e-mails exist. | `admin.service.ts` `adminLogin` vs `auth.service.ts:339` |
| S-4 | CORS allows every origin while `ALLOWED_ORIGINS` is unset. `check:prod-env` warns about this. The CORS method list omits `PUT`, which two routes export. | `src/middleware.ts:45`, `:89` |
| S-5 | The production CSP allows `'unsafe-inline'` scripts (already documented as a known follow-up). | `next.config.js` |
| S-6 | Unused tables: `support_tickets`, `support_messages`, `backups`, `notification_templates` (no code outside the schema references them). Legacy unused columns: `partner_preferences.religion_ids`, `income_min`. | grep across `src/` |
| S-7 | Rotating `AUTH_SECRET` signs everyone out and invalidates every live OTP and ticket, because session and OTP hashes are keyed with it. Document this in the runbook. | `src/server/lib/session.ts`, `src/server/lib/otp-hash.ts` |
| S-8 | No `sitemap.xml` or `robots.txt` route. Public pages do export metadata (51 files). | `git ls-files src/app` |
| S-9 | Member-facing list endpoints for likes, interests, shortlist, blocks, matches and chats return every row, with no pagination. | `interactions.repository.ts:114-120`, `chat.service.ts` `listMyChats` |
| S-10 | `scripts-smoke-otp.ts` sits at the repository root and prints a dev OTP code to the console. It is dev-only, but belongs under `scripts/`. | root listing |

## B. Changelog

### 2026-10-18 — D-1 fix (approved by owner)

* `contact-change.service.ts`: a wrong current password, a wrong or expired code, and a code issued for a different member/value now throw `AuthorizationError` (403) instead of `AuthenticationError` (401), so the BFF no longer signs the member out. A missing or invalid session still returns 401.
* `ChangeContactFlow.tsx`: the friendly "password not correct" / "code invalid" messages now key on `forbidden`.
* `tests/b19-contact-change.test.ts`: four expectations changed from 401 to 403.
* Verified: `npx vitest run tests/b19-contact-change.test.ts` 4/4 passed; `npx tsc --noEmit` exit 0.

### 2026-10-17 — Read-only audit and documentation handover

* Inspected Git state: `main` level with `origin/main`, 14 commits, last `5778152` (2026-10-13). Five untracked items, no modified files.
* Built `docs/FILE_AUDIT_CHECKLIST.md` from `git ls-files` (816 files listed, 31 generated or binary excluded).
* Read the request pipeline, server lib/config, full schema and all migrations, auth/OTP/account/admin/staff/search/payments modules. Outlined the remaining server modules. Pattern-checked all 167 API route files.
* Added `PROJECT_MEMORY.md` and these files in `docs/`: `FILE_AUDIT_CHECKLIST.md`, `PROJECT_ARCHITECTURE.md`, `FEATURE_INVENTORY.md`, `QA_BASELINE.md`, `PERFORMANCE_ROADMAP.md`, `MOBILE_APP_ROADMAP.md`, `PERSONAL_MATCHMAKING_SPEC.md`, `DECISIONS_AND_CHANGELOG.md`, `NEXT_SESSION_HANDOVER.md`.
* No application code, configuration, database or dependency was changed. Nothing was committed or pushed.
* Stale counts noticed in older documents (left unchanged; owner to decide): `FINAL_HANDOVER.md` §1 says 133 API routes, 46 pages, 13 migrations / 58 tables, 75 test files / 716 tests. The tree now has 167 route files, 51 `page.tsx`, 19 migrations / 66 tables, 91 test files, and the last log shows 814 tests. `README.md` says "Vitest, 66 files".
