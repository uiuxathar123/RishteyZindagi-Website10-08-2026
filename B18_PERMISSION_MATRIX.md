# B18 — Admin API Permission Matrix

Authoritative, test-enforced map of every `/api/v1/admin/*` route+method to the permission it requires. It is mirrored 1:1 by `tests/b18-permission-matrix.test.ts`, which fails if a route is added without a rule, a rule is stale, a role holding only the named permission is refused, or a role holding every *other* permission is let in.

Rule kinds: a permission key (checked per request against the database, so grants/revocations take effect on the next request without re-login); `SUPER` (role-name check — Super Admin only; staff roles can never be granted these); `SESSION` (any signed-in Super Admin / Staff Admin; no extra permission); `PUBLIC` (no session — admin login only).

Terminology: **User** (member), **Super Admin**, **Staff Admin**.

| Route | Method | Requires |
|---|---|---|
| `/api/v1/admin/login` | POST | **PUBLIC** |
| `/api/v1/admin/me` | GET | **SESSION** |
| `/api/v1/admin/me/password` | POST | **SESSION** |
| `/api/v1/admin/ping` | GET | **SESSION** |
| `/api/v1/admin/dashboard` | GET | `users.view` |
| `/api/v1/admin/users` | GET | `users.view` |
| `/api/v1/admin/users/[userId]` | GET | `users.view` |
| `/api/v1/admin/users/[userId]/moderation` | GET | `users.view` |
| `/api/v1/admin/users/[userId]/suspend` | POST | `users.suspend` |
| `/api/v1/admin/users/[userId]/lift-suspension` | POST | `users.suspend` |
| `/api/v1/admin/users/[userId]/ban` | POST | `users.ban` |
| `/api/v1/admin/users/[userId]/unban` | POST | `users.ban` |
| `/api/v1/admin/users/[userId]/warnings` | GET | `warnings.issue` |
| `/api/v1/admin/users/[userId]/warnings` | POST | `warnings.issue` |
| `/api/v1/admin/warning-categories` | GET | `warnings.issue` |
| `/api/v1/admin/account-deletions` | GET | `users.view` |
| `/api/v1/admin/profiles/[profileId]/verify` | PATCH | `profiles.verify` |
| `/api/v1/admin/reports` | GET | `reports.resolve` |
| `/api/v1/admin/reports/[reportId]` | PATCH | `reports.resolve` |
| `/api/v1/admin/report-categories` | GET | `reports.categories.manage` |
| `/api/v1/admin/report-categories` | POST | `reports.categories.manage` |
| `/api/v1/admin/report-categories/[categoryId]` | PATCH | `reports.categories.manage` |
| `/api/v1/admin/memberships` | GET | `payments.review` |
| `/api/v1/admin/invoices` | GET | `payments.review` |
| `/api/v1/admin/invoices/[invoiceId]` | GET | `payments.review` |
| `/api/v1/admin/invoices/[invoiceId]/cancel` | POST | `payments.review` |
| `/api/v1/admin/invoices/[invoiceId]/regenerate` | POST | `payments.review` |
| `/api/v1/admin/payments` | GET | `payments.review` |
| `/api/v1/admin/payments/[paymentId]/manual-activate` | POST | `payments.review` |
| `/api/v1/admin/payments/[paymentId]/refunds` | GET | `payments.review` |
| `/api/v1/admin/payments/[paymentId]/refunds` | POST | `payments.review` |
| `/api/v1/admin/payments/reconcile` | GET | `payments.review` |
| `/api/v1/admin/payments/reconcile` | POST | `payments.review` |
| `/api/v1/admin/payments/config` | GET | `platform.settings.manage` |
| `/api/v1/admin/payments/config` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/payments/config/[gateway]/credentials` | PUT | `platform.settings.manage` |
| `/api/v1/admin/payments/config/[gateway]/test-connection` | POST | `platform.settings.manage` |
| `/api/v1/admin/payment-gateways` | GET | `platform.settings.manage` |
| `/api/v1/admin/payment-gateways/[gatewayId]` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/payment-gateways/[gatewayId]/activate` | POST | `platform.settings.manage` |
| `/api/v1/admin/payment-gateways/[gatewayId]/deactivate` | POST | `platform.settings.manage` |
| `/api/v1/admin/payment-gateways/[gatewayId]/test-connection` | POST | `platform.settings.manage` |
| `/api/v1/admin/matching/weights` | GET | `platform.settings.manage` |
| `/api/v1/admin/matching/weights` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/otp/config` | GET | `platform.settings.manage` |
| `/api/v1/admin/otp/config` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/otp/provider` | GET | `platform.settings.manage` |
| `/api/v1/admin/otp/provider` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/otp/policy` | GET | **SUPER** |
| `/api/v1/admin/otp/policy` | PATCH | **SUPER** |
| `/api/v1/admin/platform-settings` | GET | `platform.settings.manage` |
| `/api/v1/admin/platform-settings` | PATCH | `platform.settings.manage` |
| `/api/v1/admin/membership-plans` | GET | `plans.manage` |
| `/api/v1/admin/membership-plans` | POST | `plans.manage` |
| `/api/v1/admin/membership-plans/[planId]` | PATCH | `plans.manage` |
| `/api/v1/admin/communities` | GET | `communities.manage` |
| `/api/v1/admin/communities` | POST | `communities.manage` |
| `/api/v1/admin/communities/[communityId]` | PATCH | `communities.manage` |
| `/api/v1/admin/audit-logs` | GET | `audit.view` |
| `/api/v1/admin/security-events` | GET | `audit.view` |
| `/api/v1/admin/staff` | GET | `staff.manage` |
| `/api/v1/admin/staff` | POST | `staff.manage` |
| `/api/v1/admin/staff/[staffId]` | PATCH | `staff.manage` |
| `/api/v1/admin/staff/[staffId]/reset-password` | POST | `staff.manage` |
| `/api/v1/admin/roles` | GET | `staff.manage` |
| `/api/v1/admin/roles` | POST | `staff.manage` |
| `/api/v1/admin/roles/[roleId]/permissions` | PUT | **SUPER** |

### B19 additions

| Route | Method | Requires |
|---|---|---|
| `/api/v1/admin/login/verify-mfa` | POST | **PUBLIC** |
| `/api/v1/admin/site-controls` | GET, PATCH | **SUPER** |
| `/api/v1/admin/security-settings` | GET, PATCH | **SUPER** |
| `/api/v1/admin/profile-approvals` | GET | `profiles.approve` |
| `/api/v1/admin/profile-approvals/[profileId]` | POST | `profiles.approve` |
| `/api/v1/admin/support-contact` | GET, PATCH | `support.manage` |
| `/api/v1/admin/contact-messages` | GET | `support.manage` |
| `/api/v1/admin/contact-messages/[messageId]` | PATCH | `support.manage` |
| `/api/v1/admin/success-stories` | GET, POST | `content.manage` |
| `/api/v1/admin/success-stories/[storyId]` | PATCH, DELETE | `content.manage` |
| `/api/v1/admin/dashboard/trends` | GET | `users.view` |
| `/api/v1/admin/security-events/export` | GET | `audit.view` |
| `/api/v1/admin/groups` | GET, POST | `groups.manage` |
| `/api/v1/admin/groups/[groupId]` | PATCH | `groups.manage` |
| `/api/v1/admin/groups/[groupId]/posts` | GET | `groups.manage` |
| `/api/v1/admin/groups/[groupId]/members` | GET | `groups.manage` |
| `/api/v1/admin/groups/[groupId]/members/[userId]` | PATCH | `groups.manage` |
| `/api/v1/admin/group-posts/[postId]` | PATCH | `groups.manage` |
| `/api/v1/admin/renewals` | GET | `payments.review` |

Four new permissions exist and are granted to SUPER_ADMIN only by default (a Super Admin can delegate them to a custom staff role): `profiles.approve`, `support.manage`, `content.manage`, `groups.manage`. `tests/b18-permission-matrix.test.ts` enforces these rows too.

Total rules (B18 + B19): see the test file (`MATRIX`); it is the source of truth.

(B18 total was: 67.)

Privilege-escalation boundaries: staff cannot edit role permissions or the OTP policy (SUPER); `staff.manage` is needed to create/update/reset staff and the test-suite's valid-body checks prove the 403 (not just a 400) for membership plans, communities, platform settings, reconcile and staff creation.
