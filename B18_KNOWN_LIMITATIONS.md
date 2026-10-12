# Known limitations — B18 (Pending Features & Full Admin Integration)

Read together with `PCP_KNOWN_LIMITATIONS.md`. **Items below replace those they name.** Severity scale is unchanged (P0 data loss/security … P3 minor). **No open P0 or P1.**

## Superseded PCP limitations

| PCP item | Now |
|---|---|
| P2-3 No admin screen or API for membership plans; re-seed resets them | **Fixed.** Super Admin → *Membership Plans* (`plans.manage`). Seeding never overwrites an existing plan. Prices are still placeholders until you set them there. |
| P3-8 Staff & Roles shown only in the Super group | Unchanged (UI only). |
| P3-9 Unused `GatewaysPanel` component | **Removed** in B18. The B8 `/admin/payment-gateways*` API remains for backward compatibility and is not used by any screen except the read-only Revenue tab. |
| Settings page "Not available yet": privacy, notification preferences | **Built** (see `API_REFERENCE.md` §21.3). Only *changing e-mail / mobile* remains listed as not available. |

## P2 — material caveats

| # | Limitation | Why / workaround |
|---|---|---|
| B18-P2-1 | **Third-party integrations remain mock-tested only.** Razorpay, PhonePe, Fast2SMS, SMTP, WhatsApp, FCM and S3 were exercised against in-process mocks that mimic vendor request/response shapes. B18 added no new vendor call. **Status: REQUIRES EXTERNAL CREDENTIALS / NOT VERIFIED live.** | Follow `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md`, `DEPLOYMENT_PRODUCTION.md`. Test OTP-not-required and OTP-required modes once with real SMS/e-mail before launch. |
| B18-P2-2 | **Only two workflows can be made OTP-less** (new-device log-in verification, sign-up contact verification) — by owner decision. Password reset, account recovery, OTP-only log-in, admin log-in and every payment step always require their proof. With `OTP_NOT_REQUIRED` for sign-up, a person can register an account with an e-mail/mobile they do not control; the contact is then recorded as *not verified*. | Keep sign-up on `OTP_REQUIRED` unless you accept unverified contacts. Every change is audited and Super-Admin-only. |
| B18-P2-3 | **Hidden profile does not retroactively hide existing interactions.** Chats, interests and matches that already exist remain; "hide" removes discoverability (search, recommendations, direct view, new interests), not history. Members you are connected with can still open the profile. | By design; use Block to cut off one member. |
| B18-P2-4 | **Notification preferences only affect messages the platform actually sends outside the app.** Today that is the membership-expiry reminder e-mail; everything else is in-app and never suppressed, and no WhatsApp or push message is currently produced by any feature. The WhatsApp/push switches are stored and honoured, but have nothing to switch off yet (the Settings screen says so). | Honest by construction; will take effect as soon as such messages exist. |

## P3 — minor

| # | Limitation | Notes |
|---|---|---|
| B18-P3-1 | `plans.manage` / `communities.manage` can be delegated to a Staff Admin at the API level, but their screens live under *Super Admin* navigation (`/admin/super/*`) which a non-Super role cannot open. | Delegation is therefore API-only. The page guard shows "Super Admin only". |
| B18-P3-2 | Ids of plans/communities/profile IDs in audit rows: `audit_logs.entity_id` is a uuid column, so settings changes (which have no uuid) store the setting name in `metadata.setting` instead. | Filter audit by action / metadata. |
| B18-P3-3 | The member-facing profile ID (`RZ########`) is a sequence: gaps are normal (rolled-back inserts) and it reveals approximate sign-up order, not volume. | |
| B18-P3-4 | `lastActive` is written at most once per 5 minutes per member and shown only as a coarse label. Members active before B18 have no value until their next request. | |
| B18-P3-5 | `GET /admin/security-events` merges login attempts and audit rows by time; it is a read-only view, not a SIEM (no alerting, no export, 50 per page). | |
| B18-P3-6 | The dev database (`rishteyzindagi_dev`) is not migrated automatically; run `npm run db:migrate` after pulling B18. Test and clean-export databases were migrated from scratch. | |

## Not built (documented, no control shown)

> **Update (B19):** nearly everything in this list was built afterwards — see `B19_KNOWN_LIMITATIONS.md` for what exists now and what does not (the Android app and true recurring billing remain).

Change e-mail / mobile number; admin MFA; recurring billing; real-time chat transport (polling); social "community groups"; maintenance-mode toggle; manual profile-approval mode toggle; e-mail digests; support-contact store (the Contact page says "coming soon"); CMS-managed success stories (static content); Android app (the home page now shows an honest "coming soon" notice instead of a dead Google Play link).

## Frozen-phase files touched in B18 (disclosure)

| File | Why |
|---|---|
| `db/schema.ts`, `drizzle/0012_b18_admin_controls.sql`, `db/seed.ts` | Additive tables/columns/permissions; seed no longer overwrites plans and drops the two retired feature flags. |
| `tests/db.test.ts` | Table count 57 → 58 (`platform_settings`). |
| `auth.service.ts`, `otp.service.ts` | Policy hook (`isOtpRequired`, policy tickets), sign-up kill-switch. Default behaviour with default policy is unchanged. |
| `profiles.service.ts`, `profiles.dto.ts`, `reference.repository.ts` | Public ID, privacy rules, retired-community check; `photosRestricted`/`lastActive` added to the signed-in view. |
| `search.{controller,service,repository}.ts`, `membership-gate.ts`, `memberships.service.ts`, `membership-plans.service.ts` | Profile-ID filter, sorting/page-size settings, advanced-search entitlement, entitlements on `/memberships/me`. |
| `recommendations.{repository,service}.ts`, `interactions.{repository,service}.ts` | Hidden-profile exclusion and extras. |
| `notifications.{service,repository}.ts`, `invoices.service.ts` | Per-channel opt-out; invoice resend marked essential. |
| `authenticate.ts` | Throttled `last_active_at` write. |
| `errors.ts` | `AuthorizationError` may carry `details`. |
| `rate-limit-policy.ts` | `search/access` added to the profile-read rule. |
| `tests/search-profiles.test.ts`, `tests/qa-boundary-conditions.test.ts` | `beforeEach` switches the new advanced-search gate off so their original assertions run unchanged. |
| `tests/pcp-security.test.ts` | Allow-list entry for the new public `GET /search/access`. |
| `admin.service.ts` (`adminMe`) | Any signed-in admin (including a custom-role staff account) may read its own identity and permission keys; previously only the two seeded role names could, so custom-role staff were bounced from the panel. |
| `payments/gateways.repository.ts` | Advisory lock around the gateway switch transaction (removes an intermittent deadlock / 500 under concurrent switches). |
| `tests/helpers/reset-db.ts` | `resetAdminUsers()` re-creates the `otp_configs` singleton; `activateMembershipForTests` gained an advanced-search fixture plan. |

## Test-suite timing notes (observed during B18 verification)

Four complete `npx vitest run` passes were made on a 2-core sandbox (about 14 minutes each). Pass 1: 6 failures in `performance-pagination-stability` (test-ordering hazard: `otp_configs` removed by an `admin_users` truncate; fixed in `tests/helpers/reset-db.ts`). Pass 2: 1 failure, `[cfg-concurrent-switch]` (a real deadlock between concurrent gateway switches; fixed with an advisory lock). Pass 3: `tests/pcp-otp.test.ts` `beforeAll` (starting the mock SMS and SMTP servers) hit vitest's 10 s hook timeout once, skipping that file's 15 tests; the same file passed on its own 3 times in a row and passed in every other pass. This is a load-related environment flake, not a product defect, and was not changed. Pass 4 (after all fixes, no source change since pass 3): **75 files / 716 tests passed, 0 failed**. If your CI is small, give it 4 cores or raise `hookTimeout`.

## Provider-setup phase: documented edits to existing modules

| File | Why (genuine integration defect) |
|---|---|
| `payments/credentials.ts`, `providers/razorpay.provider.ts`, `razorpay-confirm.service.ts`, `razorpay-resume.service.ts`, `payment-config.service.ts` | Key-mode guard: production previously accepted a Razorpay TEST key and non-production accepted a LIVE key (real-money risk). Now fail closed; admin status reports `detectedMode` / `problem`. |
| `config/prod-readiness-pcp.ts` | `check:prod-env` reports an env TEST key as a blocking error. |
| `lib/mailer.ts` | Added `verifySmtpConnection()` (no behaviour change to `sendMail`). |
| `components/admin/PaymentProviderPanel.tsx`, `lib/api/pcp-types.ts` | Show detected key mode and the refusal reason. |
| `scripts/smoke/pcp-prod-smoke.ts` (P5, P7, P9) | These asserted the old behaviour (a TEST key saved in a production server counted as configured and activatable); they now assert it is refused. |
| New: `scripts/check-providers.ts`, `tests/pcp-provider-setup.test.ts`, `PROVIDER_TEST_SETUP.md` | Local provider verification, tests, setup guide. |

| New: `scripts/scan-secrets.ts`, `scripts/lib/secret-scan.ts`, `scripts/git-hooks/pre-commit`, `.secretscan-allow`, `tests/secret-scan.test.ts`, `GIT_HANDOVER.md`; `.gitignore` gains `*.gpg`, `*.pass`, `*.zip`, `*.sha256` | Git-handover: local secret scanner + pre-commit hook. No Git repository is created or pushed. |
