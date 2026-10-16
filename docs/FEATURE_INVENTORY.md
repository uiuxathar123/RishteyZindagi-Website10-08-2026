# Feature Inventory

What the product does today, verified against code. Passing tests prove behaviour against a local PostgreSQL database and protocol mocks, **not** against real vendors.

How to read the evidence:

* **Server behaviour** comes from the server files marked READ or OUTLINED in `docs/FILE_AUDIT_CHECKLIST.md`.
* **Test files** are cited by name. Most of them are still PENDING in the checklist, so the citation means "this file exists and its name and a keyword search match the feature", not "its assertions were read". In the last full run (2026-10-11) 90 of the 91 files passed and 1 was skipped; see `docs/QA_BASELINE.md` for what has changed since.
* **UI**: for rows marked **Built**, a search on 2026-10-17 found a page or component that calls the feature's API. The components themselves are mostly PENDING, so UI behaviour is not verified.

## Status key

| Status | Meaning |
|---|---|
| **Built** | API implemented and tested; a UI that calls it exists (UI behaviour not verified). |
| **Built (API)** | API (or server-side tooling) implemented and tested; no UI calling it was found or none is needed. |
| **Built, vendor unverified** | Implemented against the vendor's documented protocol and tested only against a local mock. Needs real credentials and a live check. |
| **Partial** | Some of the feature exists; the gap is stated. |
| **Scaffold** | Code exists but always refuses ("not implemented"). |
| **Not built** | No code. |
| **Conflict** | Code and documentation disagree; owner decision needed (see `DECISIONS_AND_CHANGELOG.md`). |

## 1. Accounts and authentication

| Feature | Status | Notes and evidence |
|---|---|---|
| Sign-up: register → OTP → set password → signed in | Built | No account row until the password is set. `auth.service.ts`; `SignupFlow.tsx`; tests `auth-register`, `registration-otp-switch*`, `b18-otp-policy`. |
| Super Admin can make sign-up OTP optional | Built | Policy `SIGNUP_VERIFICATION`; contact stays unverified when skipped. `b18-otp-policy`. |
| Sign-up open/closed switch | Built | `platform-settings` module, key `signup.settings`. Test: `b18-otp-policy`. |
| Password login (e-mail only) | Built | Login by mobile number is not supported. `auth-login`. |
| New-device verification by OTP | Built | Keyed on `X-Device-Id`; can be turned off by policy. `auth-otp-login-device`. |
| OTP-only login | Built | `auth-otp-login-device`. |
| Forgot / reset password | Built | Revokes every session. Same response whether or not the account exists. `auth-forgot-password`. |
| Logout, logout all devices, list and revoke sessions | Built | `b18-member-settings`, `mobile-integration`. |
| Change e-mail / mobile (password + OTP to new contact) | Built | A wrong password or code used to sign the member out (D-1); fixed in `4262de9` (now 403). `ChangeContactFlow.tsx` in Settings; `b19-contact-change` (4/4 on 2026-10-17). Browser check still outstanding. |
| Account deletion with 30-day recovery | Built | Password + typed phrase; recovery needs password + e-mail OTP; finalise job anonymises. `pcp-account`. |
| Account lockout after repeated failures | Not built | Only per-IP rate limits (S-2). |
| Social login (Google, etc.) | Not built | |

## 2. OTP delivery

| Feature | Status | Notes |
|---|---|---|
| E-mail OTP over SMTP | Built, vendor unverified | `providers/email.provider.ts`; `pcp-otp`, `registration-otp-switch-smtp`. |
| SMS OTP via Fast2SMS | Built, vendor unverified | Indian +91 numbers only (D-7). `pcp-otp`, `pcp-otp-prod-guard`. |
| WhatsApp OTP | Scaffold | Always throws. |
| Admin chooses the active provider (EMAIL / FAST2SMS_SMS) | Built | Refuses an unconfigured provider in production. `pcp-provider-setup`, `otp-config`. |
| Cooldown, resend window, attempt limits, single-use, expiry | Built (API) | `otp-core`, `otp-production-guard`. |
| Dev OTP mode (no delivery, local only) | Built (API) | Blocked in production by two separate guards (`providers/factory.ts`, `providers/dev.provider.ts`). Tests: `otp-production-guard`, `pcp-otp-prod-guard`. |

## 3. Profiles

| Feature | Status | Notes |
|---|---|---|
| Create and edit profile (basics, religion, community, education, profession, income, height, location, about, lifestyle, family) | Built | `profiles-update-completion`, `ProfileSections.tsx`. |
| Completion percentage and readiness state | Built | `completion.ts`. A profile becomes visible only when complete and with at least one photo. |
| Photos: upload (5 MB, at least 200 px, max 10), primary, reorder, delete | Built | Magic-byte type check. `profiles-photos`, `PhotoManager.tsx`. |
| Photo moderation | Partial | Status column exists, defaults to PENDING, but is not enforced (D-8). |
| Photo resizing / thumbnails | Not built | Originals are served (see `PERFORMANCE_ROADMAP.md` P-2). |
| Public profile id (RZ + 8 digits) and search by id | Built | Search by id is an advanced (plan) filter. `b18-search`. |
| Verification badge (admin) | Built (API) | `profiles.verify`. `profiles-verification`. |
| Manual approval queue (Super Admin switch) | Built | Off by default; rejected profiles re-queue on edit. `b19-site-controls`. |
| Privacy: hide profile, photos only to accepted connections, hide last active | Built | `privacy.ts`; `b18-member-settings`. |
| Profile summaries batch endpoint (avatars) | Built | `profile-summaries`. |
| Horoscope / kundli matching | Not built | |
| ID document verification | Not built | Verification is an admin badge only. |

## 4. Partner preferences, search and matching

| Feature | Status | Notes |
|---|---|---|
| Partner preferences | Built | `partner-preferences`, `PartnerPreferencesPanel.tsx`. |
| Search (public and member) | Built | Anonymous visitors get a reduced view. `search-profiles`, `qa-boundary-conditions`. |
| Advanced filters behind a plan (`features.advancedSearch`) | Built | Profile id, height, income, education, profession. Super Admin can switch enforcement off. `b18-search`. |
| Recommendations with weighted scoring, tiers and explanations | Built | Admin-editable weights (sum 100). `recommendations`, `perf-query-counts`. |
| Behaviour-based ranking nudge | Built (API) | ±5 points, 60-day decay. `behaviour-events`. |
| Visibility boost | Built (API) | Granted by an active six-month-tier membership (plan `durationDays`), not by the plan's `features` JSON. `visibility-boost.ts`; test `visibility-boost`. |
| Saved searches / search alerts | Not built | |

## 5. Interactions and chat

| Feature | Status | Notes |
|---|---|---|
| Like, shortlist, block | Built | Free for every member. `interactions`, `qa-interactions-and-rbac-gaps`. |
| Send interest | **Conflict** | Code requires an active membership; `B18_FINAL_REPORT.md` says free (D-3). |
| Accept / decline / withdraw interest; mutual interest creates a match | Built | `interactions`. |
| Chat between matched members | Built | Opening and sending need any active membership (`hasActiveMembership`; the plan's `features.chat` flag is not read) and no block. `chat`. |
| Live chat updates | Built | Server-Sent Events backed by 1.5 s database polling, with fallback polling in the UI. `b19-chat-stream`. |
| Read receipts / unread counts | Built | `chat`. |
| Photo or file sharing in chat | Not built | Text only, max 2,000 characters. |
| Voice / video calls | Not built | |

## 6. Memberships, payments and invoices

| Feature | Status | Notes |
|---|---|---|
| Membership plans (8 seeded: 7-day, monthly, 3-month, 6-month × INR/USD) | Built | Prices are placeholders. Super Admin can edit plans. `membership-plans`, `b18-plans`. |
| Checkout → verify → activate | Built | Duplicate-checkout guard, no downgrade while active. `memberships`, `payments`. |
| Razorpay | Built, vendor unverified | Orders, payments, refunds, signed webhooks. `pcp-payments`, `pcp-payments-resume`, `pcp-payments-prod-guard`. |
| PhonePe | Built, vendor unverified | `pcp-payments`, `gateways`. |
| Cashfree, PayU, Paytm | Scaffold | Seeded inactive; always throw. |
| Dev payment gateway | Built (API) | Default outside production. |
| Encrypted gateway credentials saved by admin | Built | AES-256-GCM with `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`. |
| Webhooks with idempotency | Built (API) | `pcp-payments`. |
| Refunds (admin) | Built, vendor unverified | `pcp-payments`. |
| Reconciliation job and "run now" | Built | `b18-reconcile`, `pcp-jobs`. |
| Auto-renew | Partial | Only a flag plus reminders and dunning; no card mandate, so nothing is charged automatically. `b19-dunning`. |
| Upgrades | Partial | Previous membership is cancelled with no proration. |
| Invoices: PDF, download, resend, cancel, regenerate | Built | `invoices`, `invoice-resend`, `admin-invoices-list`. |
| GST-compliant invoicing | Partial | Placeholder rate, no series or tax split (D-5). |
| Currency by region | Partial | USD only for four Gulf countries (D-7). |

## 7. Notifications

| Feature | Status | Notes |
|---|---|---|
| In-app notifications, unread count, mark read | Built | `notifications`. |
| E-mail notifications | Built, vendor unverified | `pcp-notifications`. |
| Push (FCM HTTP v1) and token registry | Built (API), vendor unverified | No client app sends tokens yet. `push-tokens`, `pcp-notifications`. |
| WhatsApp notifications (Cloud API) | Built (API), vendor unverified | *(provider outlined only)* `pcp-notifications`. |
| Per-channel preferences, weekly digest (opt-in) | Built | `b18-member-settings`, `b19-digest`. |

## 8. Community, content and support

| Feature | Status | Notes |
|---|---|---|
| Community groups: join, leave, post, report; admin hide/remove | Built | `b19-groups`. |
| Contact form with admin inbox | Built | `b19-content`. |
| Success stories CMS (consent required to publish) | Built | Public page shows labelled samples until a real story is published. `b19-content`. |
| Blog and FAQ | Partial | Static content in `src/data/`; no CMS. |
| Support tickets | Not built | Tables exist (`support_tickets`, `support_messages`) but nothing uses them. |

## 9. Safety and moderation

| Feature | Status | Notes |
|---|---|---|
| Report a member (categories) | Built | `reports`. |
| Auto-suspend at 5 unique reporters | Built (API) | Lifting a suspension resets the count. `reports`. |
| Admin suspend, ban, unban with reasons | Built | `pcp-security`, `admin-users`. |
| Warnings with acknowledgement | Built | `reports`/`warnings` modules *(outlined)*. |
| Report community posts | Built | `b19-groups`. |
| Automated content filtering (abusive text, contact-detail sharing) | Not built | |

## 10. Admin and Super Admin

| Feature | Status | Notes |
|---|---|---|
| Separate admin login, optional e-mail MFA | Built | MFA off by default (D-2). `b19-admin-mfa`. |
| Dashboard totals and India-time trends | Built | Visible to Staff by default (D-4). `admin-dashboard`, `b19-dashboard-security`. |
| Users list, detail, moderation panel | Built | `admin-users`. |
| Staff and roles, temporary passwords, forced change, no privilege escalation | Built | `pcp-security`, `pcp-bootstrap-admin`, `b18-escalation`. |
| Platform settings: OTP policy and provider, search limits, sign-up switch, maintenance mode, manual approval, digest, admin security | Built | `b18-otp-policy`, `b19-site-controls`. |
| Payment gateway settings and test connection | Built | `pcp-provider-setup`, `gateways`. |
| Membership plans and communities management | Built | `b18-plans`, `b18-communities`. |
| Audit log and security events (with export) | Built | `admin-audit-logs`, `b18-security-events`, `b19-dashboard-security`. |
| Account deletions queue (read-only) | Built | `pcp-account`. |
| Permission matrix enforced across admin routes | Built (API) | `b18-permission-matrix`, `rbac`. |
| Personal / assisted matchmaking (relationship managers) | Not built | Draft spec in `PERSONAL_MATCHMAKING_SPEC.md`. |

## 11. Platform and operations

| Feature | Status | Notes |
|---|---|---|
| Health and readiness endpoints | Built (API) | `health`, `health-ready`. |
| Shared (Postgres) rate limiting | Built (API) | `pcp-foundation`, `security-concurrency`. |
| Maintenance mode | Built | `b19-site-controls`. |
| Scheduled jobs (8) via CLI or HTTP + secret | Built (API) | `pcp-jobs`, `pcp-foundation`. No built-in scheduler. |
| Encrypted backups, restore verification, off-box copy | Built (scripts) | `pcp-backup` skips when tools are missing (it did on 2026-10-11). |
| Secret scanner and pre-commit hook | Built (API) | `secret-scan`. |
| Production environment check | Built (API) | `prod-readiness`. |
| CI pipeline, container image | Not built | |
| Native Android / iOS app | Not built | API readiness in `MOBILE_APP_ROADMAP.md`. |
| Multi-language UI (Hindi, Urdu, etc.) | Not built | |
