# File Audit Checklist

Tracks which repository files have actually been inspected during the documentation audit. It is regenerated from `git ls-files`, so it covers every tracked file except generated ones (listed under "Excluded").

**Audit started:** 2026-10-17 · **List generated at:** `main` `5778152`; updated for `4262de9` (D-1 fix) · **Tracked files:** 849 (818 listed below, 31 excluded as generated/binary). The eight audit documents in `docs/` written after this list was generated (`FILE_AUDIT_CHECKLIST.md` itself, `PROJECT_ARCHITECTURE.md`, `FEATURE_INVENTORY.md`, `QA_BASELINE.md`, `PERFORMANCE_ROADMAP.md`, `MOBILE_APP_ROADMAP.md`, `PERSONAL_MATCHMAKING_SPEC.md`, `NEXT_SESSION_HANDOVER.md`) are not listed; add them as READ the next time the list is regenerated.

## Status meanings

| Status | Meaning |
|---|---|
| `READ` | Opened and read in full during this audit. |
| `OUTLINED` | Opened, but only the header, exported functions, constants or specific sections were read (grep/sed). Findings from these files are marked as such in the other documents. |
| `PATTERN-VERIFIED` | Not read individually. A scripted check across the whole group confirmed the shared pattern (for API routes: every `route.ts` is wrapped in `withErrorHandling` and is at most 30 lines; logic lives in the controllers listed as READ/OUTLINED). |
| `PENDING` | Not opened yet. No claim about the *contents* of these files is made in the other documents. Some are cited by name only (for example test files in `FEATURE_INVENTORY.md` and `QA_BASELINE.md`), which means the file exists and its name matches the feature. |
| `NOT READ (secret)` | Deliberately never opened, because it holds real credentials. |

## Coverage summary

| Batch | Area | READ | OUTLINED | PATTERN-VERIFIED | PENDING |
|---|---|---|---|---|---|
| CONFIG | Root configuration | 10 | 0 | 0 | 5 |
| DOC | Documentation (.md/.txt) | 6 | 6 | 0 | 46 |
| B1-UI-public | Public site pages + home/layout components | 1 | 2 | 0 | 44 |
| B1-UI-member | Member dashboard pages + components | 0 | 2 | 0 | 37 |
| B1-UI-admin | Admin panel pages + components | 0 | 1 | 0 | 58 |
| B1-UI-shared | Shared UI, lib, data, middleware | 10 | 1 | 0 | 60 |
| B3-DB | Schema, migrations, seed | 23 | 2 | 0 | 0 |
| B4-API | API route adapters (src/app/api) | 1 | 0 | 166 | 0 |
| B4-server | Server modules, lib, middleware, jobs | 57 | 50 | 0 | 101 |
| B9-tests | Tests and test helpers | 0 | 7 | 0 | 95 |
| B9-ops | Scripts (ops, smoke, backup) | 2 | 2 | 0 | 23 |
| **Total** | 818 files | **110** | **73** | **166** | **469** |

**The audit is not complete.** The PENDING files are mainly UI components, tests and older phase documents. See `docs/NEXT_SESSION_HANDOVER.md` for the order to finish them in.

## Not tracked by Git, but present in the working folder

| Path | Status | Notes |
|---|---|---|
| `.env`, `.env.test`, `.env.test.bak-20261009` | NOT READ (secret) | Real local credentials. Ignored by `.gitignore`; confirmed untracked with `git ls-files`. Values never opened. |
| `COMMIT_1.txt`, `COMMIT_2.txt`, `PROPOSED_COMMITS.md` | READ | Commit-message drafts from the pre-Git handover. Superseded: the repository now has 15 commits. |
| `post-b19-audit.patch` | OUTLINED | 7-file docs/logger patch. Its content is already in `HEAD` (logger redaction keys, `LOCAL_SETUP.md` §18, eight-job table). It no longer applies cleanly in either direction. |
| `gate1/apply-gate1.ps1`, `gate1/manifest.csv` | OUTLINED | Gate 1 change package (profile summaries, avatars, photo cache header). |
| `gate1/files/**` (16 files) | Compared byte-for-byte with `src/` | 15 are identical to the tree. `src/app/api/v1/profiles/photos/[photoId]/file/route.ts` differs: the package sets `Cache-Control: private, max-age=86400, immutable`, while the tree keeps `private, no-store`. |
| `_backups/` (2 snapshot folders) | Listed only | Local safety copies from Gate 1 and the OTP switch. Ignored by Git. |
| `.storage-local/` | Listed only | Local uploaded photos and generated invoice PDFs. Runtime data. |
| `vitest-full.log` (7.7 MB, UTF-16) | Summary read | Full test run of 2026-10-11 19:09: 91 files (90 passed, 1 skipped), 814 tests (794 passed, 20 skipped, 0 failed), 1,669 s. |
| `tsconfig.tsbuildinfo`, `.next/`, `node_modules/` | Excluded | Generated. `.next` holds a dev build from 2026-10-14 (no `BUILD_ID`, so no production build). |

## Excluded (generated or binary)

* `drizzle/meta/00xx_snapshot.json` (19 files, about 108,000 lines): drizzle-kit snapshots. `drizzle/meta/_journal.json` was read.
* `src/app/fonts/*.woff2` (12 files): font binaries. The two licence `.txt` files are listed below.

## File list


### B1-UI-admin

| File | Lines | Status |
|---|---|---|
| `src/app/admin/(panel)/account-deletions/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/groups/page.tsx` | 13 | PENDING |
| `src/app/admin/(panel)/inbox/page.tsx` | 13 | PENDING |
| `src/app/admin/(panel)/layout.tsx` | 28 | PENDING |
| `src/app/admin/(panel)/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/profiles/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/reports/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/settings/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/stories/page.tsx` | 13 | PENDING |
| `src/app/admin/(panel)/super/audit-log/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/super/communities/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/super/layout.tsx` | 31 | PENDING |
| `src/app/admin/(panel)/super/membership-plans/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/super/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/super/revenue/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/super/security-events/page.tsx` | 16 | PENDING |
| `src/app/admin/(panel)/super/settings/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/super/staff/page.tsx` | 11 | PENDING |
| `src/app/admin/(panel)/users/page.tsx` | 20 | PENDING |
| `src/app/admin/(panel)/visibility-queue/page.tsx` | 16 | PENDING |
| `src/app/admin/layout.tsx` | 16 | PENDING |
| `src/app/admin/login/page.tsx` | 32 | PENDING |
| `src/components/admin/AccountDeletionsClient.tsx` | 103 | PENDING |
| `src/components/admin/AdminLoginForm.tsx` | 139 | PENDING |
| `src/components/admin/AdminSessionProvider.tsx` | 65 | PENDING |
| `src/components/admin/AdminShell.tsx` | 263 | PENDING |
| `src/components/admin/AdminUi.tsx` | 268 | PENDING |
| `src/components/admin/AuditLogClient.tsx` | 205 | PENDING |
| `src/components/admin/CommunitiesClient.tsx` | 214 | PENDING |
| `src/components/admin/ForcePasswordChange.tsx` | 79 | PENDING |
| `src/components/admin/GroupsClient.tsx` | 193 | PENDING |
| `src/components/admin/ModerationPanel.tsx` | 181 | PENDING |
| `src/components/admin/OtpPolicyPanel.tsx` | 159 | PENDING |
| `src/components/admin/OtpProviderPanel.tsx` | 111 | PENDING |
| `src/components/admin/OverviewClient.tsx` | 164 | OUTLINED |
| `src/components/admin/PaymentProviderPanel.tsx` | 254 | PENDING |
| `src/components/admin/PermissionGate.tsx` | 25 | PENDING |
| `src/components/admin/PlansClient.tsx` | 234 | PENDING |
| `src/components/admin/PlatformSettingsClient.tsx` | 34 | PENDING |
| `src/components/admin/ProfileApprovalsClient.tsx` | 222 | PENDING |
| `src/components/admin/ReconcilePanel.tsx` | 118 | PENDING |
| `src/components/admin/RefundModal.tsx` | 116 | PENDING |
| `src/components/admin/ReportsClient.tsx` | 315 | PENDING |
| `src/components/admin/RevenueClient.tsx` | 504 | PENDING |
| `src/components/admin/SearchSignupSettingsPanel.tsx` | 153 | PENDING |
| `src/components/admin/SecurityEventsClient.tsx` | 182 | PENDING |
| `src/components/admin/SettingsClient.tsx` | 72 | PENDING |
| `src/components/admin/SettingsPanels.tsx` | 275 | PENDING |
| `src/components/admin/SiteControlsPanel.tsx` | 207 | PENDING |
| `src/components/admin/StaffClient.tsx` | 487 | PENDING |
| `src/components/admin/StatCard.tsx` | 32 | PENDING |
| `src/components/admin/StoriesClient.tsx` | 101 | PENDING |
| `src/components/admin/SuperOverviewClient.tsx` | 117 | PENDING |
| `src/components/admin/SupportInboxClient.tsx` | 132 | PENDING |
| `src/components/admin/TrendChart.tsx` | 51 | PENDING |
| `src/components/admin/UsersClient.tsx` | 418 | PENDING |
| `src/components/admin/VerifyControls.tsx` | 105 | PENDING |
| `src/components/admin/VisibilityQueueClient.tsx` | 111 | PENDING |
| `src/components/admin/adminTypes.ts` | 192 | PENDING |

### B1-UI-member

| File | Lines | Status |
|---|---|---|
| `src/app/dashboard/groups/page.tsx` | 14 | PENDING |
| `src/app/dashboard/interests/page.tsx` | 18 | PENDING |
| `src/app/dashboard/layout.tsx` | 45 | PENDING |
| `src/app/dashboard/matches/page.tsx` | 18 | PENDING |
| `src/app/dashboard/members/[id]/page.tsx` | 10 | PENDING |
| `src/app/dashboard/membership/page.tsx` | 18 | PENDING |
| `src/app/dashboard/messages/page.tsx` | 19 | PENDING |
| `src/app/dashboard/notifications/page.tsx` | 16 | PENDING |
| `src/app/dashboard/page.tsx` | 10 | PENDING |
| `src/app/dashboard/profile/page.tsx` | 18 | PENDING |
| `src/app/dashboard/settings/page.tsx` | 16 | PENDING |
| `src/app/dashboard/shortlist/page.tsx` | 16 | PENDING |
| `src/components/dashboard/ChangeContactFlow.tsx` | 109 | OUTLINED |
| `src/components/dashboard/DashboardShell.tsx` | 318 | PENDING |
| `src/components/dashboard/GroupsView.tsx` | 154 | PENDING |
| `src/components/dashboard/InterestsView.tsx` | 254 | PENDING |
| `src/components/dashboard/MessagesView.tsx` | 453 | OUTLINED |
| `src/components/dashboard/NotificationsList.tsx` | 171 | PENDING |
| `src/components/dashboard/ProfileEditor.tsx` | 118 | PENDING |
| `src/components/dashboard/SettingsView.tsx` | 535 | PENDING |
| `src/components/dashboard/ShortlistGrid.tsx` | 142 | PENDING |
| `src/components/dashboard/member/MatchesView.tsx` | 161 | PENDING |
| `src/components/dashboard/member/MemberProfileView.tsx` | 296 | PENDING |
| `src/components/dashboard/member/PersonRow.tsx` | 69 | PENDING |
| `src/components/dashboard/member/SafetyPanels.tsx` | 123 | PENDING |
| `src/components/dashboard/membership/CurrentMembershipCard.tsx` | 188 | PENDING |
| `src/components/dashboard/membership/InvoicesSection.tsx` | 69 | PENDING |
| `src/components/dashboard/membership/MembershipDashboard.tsx` | 112 | PENDING |
| `src/components/dashboard/membership/PaymentsSection.tsx` | 74 | PENDING |
| `src/components/dashboard/overview/DashboardOverview.tsx` | 23 | PENDING |
| `src/components/dashboard/overview/widgets.tsx` | 408 | PENDING |
| `src/components/dashboard/profile/CreateProfileStep.tsx` | 92 | PENDING |
| `src/components/dashboard/profile/PartnerPreferencesPanel.tsx` | 337 | PENDING |
| `src/components/dashboard/profile/ProfileSections.tsx` | 723 | PENDING |
| `src/components/dashboard/profile/SectionCard.tsx` | 120 | PENDING |
| `src/components/dashboard/profile/StatusPanel.tsx` | 93 | PENDING |
| `src/components/dashboard/profile/profileForm.ts` | 136 | PENDING |
| `src/components/dashboard/profile/useReferenceLists.ts` | 72 | PENDING |
| `src/components/dashboard/profile/useSection.ts` | 81 | PENDING |

### B1-UI-public

| File | Lines | Status |
|---|---|---|
| `src/app/(marketing)/about/page.tsx` | 87 | PENDING |
| `src/app/(marketing)/blog/[slug]/page.tsx` | 124 | PENDING |
| `src/app/(marketing)/blog/page.tsx` | 85 | PENDING |
| `src/app/(marketing)/contact/page.tsx` | 114 | PENDING |
| `src/app/(marketing)/faq/page.tsx` | 40 | PENDING |
| `src/app/(marketing)/forgot-password/page.tsx` | 34 | PENDING |
| `src/app/(marketing)/home/page.tsx` | 7 | PENDING |
| `src/app/(marketing)/how-it-works/page.tsx` | 132 | PENDING |
| `src/app/(marketing)/layout.tsx` | 26 | PENDING |
| `src/app/(marketing)/login/page.tsx` | 35 | PENDING |
| `src/app/(marketing)/membership/checkout/page.tsx` | 51 | PENDING |
| `src/app/(marketing)/membership/page.tsx` | 71 | PENDING |
| `src/app/(marketing)/membership/payment-return/page.tsx` | 36 | PENDING |
| `src/app/(marketing)/page.tsx` | 37 | PENDING |
| `src/app/(marketing)/privacy-policy/page.tsx` | 92 | PENDING |
| `src/app/(marketing)/recover-account/page.tsx` | 33 | PENDING |
| `src/app/(marketing)/refund-policy/page.tsx` | 51 | PENDING |
| `src/app/(marketing)/safety/page.tsx` | 101 | PENDING |
| `src/app/(marketing)/search/page.tsx` | 30 | READ |
| `src/app/(marketing)/signup/page.tsx` | 23 | PENDING |
| `src/app/(marketing)/success-stories/page.tsx` | 120 | PENDING |
| `src/app/(marketing)/terms/page.tsx` | 62 | PENDING |
| `src/components/contact/ContactForm.tsx` | 83 | PENDING |
| `src/components/home/AnniversaryNumeral.tsx` | 93 | PENDING |
| `src/components/home/AppPromotion.tsx` | 68 | PENDING |
| `src/components/home/Experience.tsx` | 65 | PENDING |
| `src/components/home/ExploreProfiles.tsx` | 82 | PENDING |
| `src/components/home/FAQPreview.tsx` | 20 | PENDING |
| `src/components/home/FeaturedProfiles.tsx` | 69 | OUTLINED |
| `src/components/home/FinalCTA.tsx` | 26 | PENDING |
| `src/components/home/Hero.module.css` | 249 | PENDING |
| `src/components/home/Hero.tsx` | 163 | PENDING |
| `src/components/home/HeroSearchForm.tsx` | 123 | PENDING |
| `src/components/home/HowItWorks.tsx` | 53 | PENDING |
| `src/components/home/MembershipPreview.tsx` | 23 | PENDING |
| `src/components/home/NRIConnections.tsx` | 47 | PENDING |
| `src/components/home/QuickBrowse.tsx` | 55 | PENDING |
| `src/components/home/SafetyTrust.tsx` | 40 | PENDING |
| `src/components/home/SmartMatchingSection.tsx` | 38 | PENDING |
| `src/components/home/Testimonials.tsx` | 43 | OUTLINED |
| `src/components/home/TrustStrip.tsx` | 35 | PENDING |
| `src/components/home/browseLookups.ts` | 41 | PENDING |
| `src/components/layout/Footer.tsx` | 191 | PENDING |
| `src/components/layout/Header.tsx` | 196 | PENDING |
| `src/components/layout/HeaderAuth.tsx` | 109 | PENDING |
| `src/components/layout/SiteStatusBanner.tsx` | 42 | PENDING |
| `src/components/legal/LegalPage.tsx` | 56 | PENDING |

### B1-UI-shared

| File | Lines | Status |
|---|---|---|
| `src/app/bff/[...path]/route.ts` | 195 | READ |
| `src/app/bff/dev/otp-code/route.ts` | 45 | PENDING |
| `src/app/bff/dev/status/route.ts` | 25 | PENDING |
| `src/app/fonts/DM-SANS-LICENSE.txt` | 93 | PENDING |
| `src/app/fonts/PLAYFAIR-DISPLAY-LICENSE.txt` | 93 | PENDING |
| `src/app/globals.css` | 60 | PENDING |
| `src/app/icon.svg` | 4 | PENDING |
| `src/app/layout.tsx` | 97 | PENDING |
| `src/components/auth/DevOtpHelper.tsx` | 61 | PENDING |
| `src/components/auth/FormAlert.tsx` | 41 | PENDING |
| `src/components/auth/LoginForm.tsx` | 229 | PENDING |
| `src/components/auth/OtpChallengePanel.tsx` | 225 | PENDING |
| `src/components/auth/RecoverAccountFlow.tsx` | 128 | PENDING |
| `src/components/auth/ResetPasswordFlow.tsx` | 181 | PENDING |
| `src/components/auth/SignupFlow.tsx` | 512 | PENDING |
| `src/components/auth/safeNext.ts` | 21 | PENDING |
| `src/components/forms/LookupSelect.tsx` | 47 | PENDING |
| `src/components/forms/MultiSelect.tsx` | 40 | PENDING |
| `src/components/membership/CheckoutClient.tsx` | 635 | PENDING |
| `src/components/membership/InvoiceDownloadButton.tsx` | 88 | PENDING |
| `src/components/membership/PaymentReturnClient.tsx` | 139 | PENDING |
| `src/components/membership/PlanCard.tsx` | 80 | PENDING |
| `src/components/membership/PlansCatalog.tsx` | 183 | PENDING |
| `src/components/membership/currentMembership.server.ts` | 26 | PENDING |
| `src/components/membership/planUtils.ts` | 58 | PENDING |
| `src/components/profile/ActionError.tsx` | 37 | OUTLINED |
| `src/components/profile/MatchScore.tsx` | 104 | PENDING |
| `src/components/profile/Pager.tsx` | 32 | PENDING |
| `src/components/profile/ProfileCard.tsx` | 262 | PENDING |
| `src/components/profile/cardModel.ts` | 122 | PENDING |
| `src/components/profile/photos/PhotoManager.tsx` | 321 | PENDING |
| `src/components/profile/relations.ts` | 169 | PENDING |
| `src/components/profile/useMyPrimaryPhoto.ts` | 40 | PENDING |
| `src/components/profile/useProfileActions.ts` | 89 | PENDING |
| `src/components/profile/useProfileSummaries.ts` | 91 | PENDING |
| `src/components/search/FilterPanel.tsx` | 259 | PENDING |
| `src/components/search/SearchClient.tsx` | 186 | PENDING |
| `src/components/search/searchFilters.ts` | 137 | PENDING |
| `src/components/session/SessionProvider.tsx` | 101 | PENDING |
| `src/components/ui/Accordion.tsx` | 53 | PENDING |
| `src/components/ui/AsyncView.tsx` | 66 | PENDING |
| `src/components/ui/Avatar.tsx` | 55 | PENDING |
| `src/components/ui/Badge.tsx` | 67 | PENDING |
| `src/components/ui/Button.tsx` | 90 | PENDING |
| `src/components/ui/Container.tsx` | 50 | PENDING |
| `src/components/ui/Input.tsx` | 83 | PENDING |
| `src/components/ui/PhotoImage.tsx` | 49 | PENDING |
| `src/components/ui/StarRating.tsx` | 18 | PENDING |
| `src/components/ui/States.tsx` | 85 | PENDING |
| `src/components/ui/Tabs.tsx` | 70 | PENDING |
| `src/components/ui/Toggle.tsx` | 59 | PENDING |
| `src/data/blogPosts.ts` | 168 | PENDING |
| `src/data/faqs.ts` | 69 | PENDING |
| `src/data/testimonials.ts` | 65 | PENDING |
| `src/lib/api/b18-types.ts` | 79 | PENDING |
| `src/lib/api/b19-types.ts` | 112 | PENDING |
| `src/lib/api/client.ts` | 129 | READ |
| `src/lib/api/errors.ts` | 79 | READ |
| `src/lib/api/hooks.ts` | 90 | READ |
| `src/lib/api/lookups.ts` | 52 | READ |
| `src/lib/api/pcp-types.ts` | 147 | PENDING |
| `src/lib/api/server.ts` | 44 | READ |
| `src/lib/api/types.ts` | 559 | PENDING |
| `src/lib/bff/config.ts` | 53 | READ |
| `src/lib/format.ts` | 72 | PENDING |
| `src/lib/payments/gateway-handoff.ts` | 99 | PENDING |
| `src/lib/photo.ts` | 19 | READ |
| `src/lib/utils.ts` | 15 | PENDING |
| `src/middleware.ts` | 127 | READ |
| `src/services/README.md` | 7 | PENDING |
| `src/services/blogService.ts` | 20 | READ |

### B3-DB

| File | Lines | Status |
|---|---|---|
| `drizzle/0000_nosy_polaris.sql` | 581 | READ |
| `drizzle/0001_b2_auth_otp.sql` | 57 | READ |
| `drizzle/0002_b3_profile_photos.sql` | 20 | READ |
| `drizzle/0003_b4_partner_preferences_search.sql` | 15 | READ |
| `drizzle/0004_b5_gap_fixes.sql` | 28 | READ |
| `drizzle/0005_b6_social_interaction.sql` | 27 | READ |
| `drizzle/0006_b7_chat_notifications.sql` | 9 | READ |
| `drizzle/0007_b8_membership_payment.sql` | 7 | READ |
| `drizzle/0008_b10_security_hardening.sql` | 0 | READ |
| `drizzle/0009_b11_push_tokens.sql` | 13 | READ |
| `drizzle/0010_b13_performance_indexes.sql` | 29 | READ |
| `drizzle/0011_pcp_production_completion.sql` | 72 | READ |
| `drizzle/0012_b18_admin_controls.sql` | 29 | READ |
| `drizzle/0013_b19_profile_approval.sql` | 15 | READ |
| `drizzle/0014_b19_otp_purposes.sql` | 1 | READ |
| `drizzle/0015_b19_contact_stories.sql` | 41 | READ |
| `drizzle/0016_b19_digest_log.sql` | 9 | READ |
| `drizzle/0017_b19_community_groups.sql` | 62 | READ |
| `drizzle/0018_b19_renewal_cycles.sql` | 16 | READ |
| `drizzle/meta/_journal.json` | 138 | READ |
| `src/server/db/client.ts` | 69 | READ |
| `src/server/db/migrate.ts` | 32 | READ |
| `src/server/db/reference-data/communities.ts` | 280 | OUTLINED |
| `src/server/db/schema.ts` | 1874 | READ |
| `src/server/db/seed.ts` | 600 | OUTLINED |

### B4-API

| File | Lines | Status |
|---|---|---|
| `src/app/api/v1/admin/account-deletions/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/audit-logs/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/communities/[communityId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/communities/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/contact-messages/[messageId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/contact-messages/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/dashboard/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/dashboard/trends/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/group-posts/[postId]/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/groups/[groupId]/members/[userId]/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/groups/[groupId]/members/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/groups/[groupId]/posts/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/groups/[groupId]/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/groups/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/invoices/[invoiceId]/cancel/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/invoices/[invoiceId]/regenerate/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/invoices/[invoiceId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/invoices/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/login/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/login/verify-mfa/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/matching/weights/route.ts` | 10 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/me/password/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/membership-plans/[planId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/membership-plans/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/memberships/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/otp/config/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/otp/policy/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/otp/provider/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payment-gateways/[gatewayId]/activate/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payment-gateways/[gatewayId]/deactivate/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payment-gateways/[gatewayId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payment-gateways/[gatewayId]/test-connection/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payment-gateways/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/[paymentId]/manual-activate/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/[paymentId]/refunds/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/config/[gateway]/credentials/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/config/[gateway]/test-connection/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/config/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/reconcile/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/payments/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/ping/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/platform-settings/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/profile-approvals/[profileId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/profile-approvals/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/profiles/[profileId]/verify/route.ts` | 11 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/renewals/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/report-categories/[categoryId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/report-categories/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/reports/[reportId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/reports/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/roles/[roleId]/permissions/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/roles/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/security-events/export/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/security-events/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/security-settings/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/site-controls/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/staff/[staffId]/reset-password/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/staff/[staffId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/staff/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/success-stories/[storyId]/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/success-stories/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/support-contact/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/ban/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/lift-suspension/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/moderation/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/suspend/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/unban/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/[userId]/warnings/route.ts` | 11 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/users/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/admin/warning-categories/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/forgot-password/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/login/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/logout-all/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/logout/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/recover-account/confirm/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/recover-account/request/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/register/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/request-login-otp/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/resend-otp/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/reset-password/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/set-password/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/verify-device/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/verify-login-otp/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/auth/verify-signup-otp/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/chats/[chatId]/messages/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/chats/[chatId]/read/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/chats/[chatId]/stream/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/chats/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/chats/unread-count/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/contact/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/devices/push-tokens/[tokenOrId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/devices/push-tokens/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/group-posts/[postId]/report/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/group-posts/[postId]/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/groups/[groupId]/join/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/groups/[groupId]/leave/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/groups/[groupId]/posts/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/groups/[groupId]/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/groups/route.ts` | 5 | PATTERN-VERIFIED |
| `src/app/api/v1/health/ready/route.ts` | 10 | PATTERN-VERIFIED |
| `src/app/api/v1/health/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/blocks/[targetUserId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/blocks/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/interests/[interestId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/interests/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/likes/[toUserId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/likes/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/matches/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/shortlist/[targetUserId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/interactions/shortlist/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/internal/jobs/[job]/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/invoices/[invoiceId]/download/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/invoices/[invoiceId]/resend/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/invoices/[invoiceId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/invoices/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/membership-plans/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/membership-plans/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/checkout/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/[membershipId]/cancel-auto-renew/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/[membershipId]/enable-auto-renew/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/auto-renew-attempt/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/history/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/renew/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/renewal-reminder-check/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/memberships/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/notifications/[notificationId]/read/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/notifications/read-all/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/notifications/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/notifications/unread-count/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/payments/[paymentId]/razorpay/confirm/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/payments/[paymentId]/razorpay/resume/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/payments/[paymentId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/payments/[paymentId]/verify/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/payments/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/[profileId]/route.ts` | 10 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/completion/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/partner-preferences/route.ts` | 10 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/photos/[photoId]/primary/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/photos/[photoId]/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/photos/reorder/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/photos/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/recommendations/route.ts` | 11 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/me/route.ts` | 13 | PATTERN-VERIFIED |
| `src/app/api/v1/profiles/photos/[photoId]/file/route.ts` | 30 | READ |
| `src/app/api/v1/profiles/summaries/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/reference/profile-options/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/reports/categories/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/reports/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/search/access/route.ts` | 9 | PATTERN-VERIFIED |
| `src/app/api/v1/search/profiles/route.ts` | 9 | PATTERN-VERIFIED |
| `src/app/api/v1/site-status/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/success-stories/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/support-contact/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/contact-change/confirm/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/contact-change/request/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/delete-account/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/notification-preferences/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/privacy/route.ts` | 7 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/sessions/[sessionId]/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/users/me/sessions/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/warnings/[warningId]/acknowledge/route.ts` | 8 | PATTERN-VERIFIED |
| `src/app/api/v1/warnings/me/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/webhooks/phonepe/route.ts` | 6 | PATTERN-VERIFIED |
| `src/app/api/v1/webhooks/razorpay/route.ts` | 6 | PATTERN-VERIFIED |

### B4-server

| File | Lines | Status |
|---|---|---|
| `src/server/config/env.ts` | 178 | READ |
| `src/server/config/prod-readiness-pcp.ts` | 45 | READ |
| `src/server/config/prod-readiness.ts` | 117 | READ |
| `src/server/jobs/definitions/digest.ts` | 136 | OUTLINED |
| `src/server/jobs/definitions/dunning.ts` | 80 | OUTLINED |
| `src/server/jobs/definitions/housekeeping.ts` | 22 | OUTLINED |
| `src/server/jobs/definitions/membership.ts` | 187 | OUTLINED |
| `src/server/jobs/definitions/payments.ts` | 152 | OUTLINED |
| `src/server/jobs/jobs.controller.ts` | 41 | OUTLINED |
| `src/server/jobs/registry.ts` | 30 | OUTLINED |
| `src/server/jobs/runner.ts` | 71 | OUTLINED |
| `src/server/jobs/types.ts` | 27 | PENDING |
| `src/server/lib/client-ip.ts` | 35 | READ |
| `src/server/lib/crypto.ts` | 64 | READ |
| `src/server/lib/errors.ts` | 89 | READ |
| `src/server/lib/logger.ts` | 80 | READ |
| `src/server/lib/mailer.ts` | 107 | READ |
| `src/server/lib/otp-hash.ts` | 48 | READ |
| `src/server/lib/password.ts` | 19 | READ |
| `src/server/lib/rate-limit-store.ts` | 118 | READ |
| `src/server/lib/response.ts` | 33 | READ |
| `src/server/lib/session.ts` | 31 | READ |
| `src/server/lib/sigv4.ts` | 103 | READ |
| `src/server/lib/validate.ts` | 27 | READ |
| `src/server/middleware/authenticate.ts` | 96 | READ |
| `src/server/middleware/error-handler.ts` | 81 | READ |
| `src/server/middleware/maintenance.ts` | 33 | READ |
| `src/server/middleware/rate-limit-policy.ts` | 127 | READ |
| `src/server/middleware/rate-limit.ts` | 43 | READ |
| `src/server/middleware/rbac.ts` | 51 | READ |
| `src/server/modules/account/account-deletion.controller.ts` | 56 | READ |
| `src/server/modules/account/account-deletion.service.ts` | 270 | READ |
| `src/server/modules/account/contact-change.service.ts` | 162 | READ (re-read after the D-1 fix in `4262de9`) |
| `src/server/modules/account/member-settings.controller.ts` | 93 | READ |
| `src/server/modules/account/member-settings.service.ts` | 169 | READ |
| `src/server/modules/account/sessions.ts` | 34 | READ |
| `src/server/modules/admin/admin.controller.ts` | 52 | READ |
| `src/server/modules/admin/admin.service.ts` | 256 | READ |
| `src/server/modules/admin/audit-logs.controller.ts` | 42 | PENDING |
| `src/server/modules/admin/audit-logs.repository.ts` | 63 | PENDING |
| `src/server/modules/admin/audit-logs.service.ts` | 60 | PENDING |
| `src/server/modules/admin/communities-admin.controller.ts` | 49 | PENDING |
| `src/server/modules/admin/communities-admin.service.ts` | 155 | PENDING |
| `src/server/modules/admin/dashboard.controller.ts` | 22 | PENDING |
| `src/server/modules/admin/dashboard.repository.ts` | 180 | OUTLINED |
| `src/server/modules/admin/dashboard.service.ts` | 66 | READ |
| `src/server/modules/admin/invoices-admin.controller.ts` | 52 | PENDING |
| `src/server/modules/admin/invoices-admin.repository.ts` | 126 | PENDING |
| `src/server/modules/admin/invoices-admin.service.ts` | 104 | PENDING |
| `src/server/modules/admin/memberships-admin.controller.ts` | 41 | PENDING |
| `src/server/modules/admin/memberships-admin.repository.ts` | 74 | PENDING |
| `src/server/modules/admin/memberships-admin.service.ts` | 102 | PENDING |
| `src/server/modules/admin/plans-admin.controller.ts` | 58 | PENDING |
| `src/server/modules/admin/plans-admin.service.ts` | 181 | PENDING |
| `src/server/modules/admin/reconcile-admin.controller.ts` | 18 | PENDING |
| `src/server/modules/admin/reconcile-admin.service.ts` | 64 | PENDING |
| `src/server/modules/admin/security-events.controller.ts` | 46 | PENDING |
| `src/server/modules/admin/security-events.service.ts` | 193 | PENDING |
| `src/server/modules/admin/users-admin.controller.ts` | 59 | PENDING |
| `src/server/modules/admin/users-admin.dto.ts` | 171 | PENDING |
| `src/server/modules/admin/users-admin.repository.ts` | 134 | PENDING |
| `src/server/modules/admin/users-admin.service.ts` | 105 | PENDING |
| `src/server/modules/audit/audit.service.ts` | 52 | READ |
| `src/server/modules/auth/auth.controller.ts` | 211 | READ |
| `src/server/modules/auth/auth.service.ts` | 621 | READ |
| `src/server/modules/behaviour-events/behaviour-events.repository.ts` | 171 | PENDING |
| `src/server/modules/behaviour-events/behaviour-events.service.ts` | 20 | PENDING |
| `src/server/modules/chat/chat-stream.ts` | 129 | OUTLINED |
| `src/server/modules/chat/chat.controller.ts` | 115 | OUTLINED |
| `src/server/modules/chat/chat.dto.ts` | 91 | PENDING |
| `src/server/modules/chat/chat.repository.ts` | 240 | PENDING |
| `src/server/modules/chat/chat.service.ts` | 196 | OUTLINED |
| `src/server/modules/content/content.controller.ts` | 79 | PENDING |
| `src/server/modules/content/content.service.ts` | 254 | OUTLINED |
| `src/server/modules/devices/push-tokens.controller.ts` | 59 | PENDING |
| `src/server/modules/devices/push-tokens.dto.ts` | 36 | PENDING |
| `src/server/modules/devices/push-tokens.repository.ts` | 77 | PENDING |
| `src/server/modules/devices/push-tokens.service.ts` | 92 | OUTLINED |
| `src/server/modules/groups/groups.controller.ts` | 104 | PENDING |
| `src/server/modules/groups/groups.service.ts` | 374 | OUTLINED |
| `src/server/modules/health/health.controller.ts` | 100 | OUTLINED |
| `src/server/modules/interactions/interactions.controller.ts` | 171 | PENDING |
| `src/server/modules/interactions/interactions.dto.ts` | 134 | PENDING |
| `src/server/modules/interactions/interactions.repository.ts` | 326 | OUTLINED |
| `src/server/modules/interactions/interactions.service.ts` | 409 | OUTLINED |
| `src/server/modules/invoices/invoice-number.ts` | 28 | READ |
| `src/server/modules/invoices/invoice-pdf.ts` | 169 | PENDING |
| `src/server/modules/invoices/invoices.controller.ts` | 90 | PENDING |
| `src/server/modules/invoices/invoices.dto.ts` | 40 | PENDING |
| `src/server/modules/invoices/invoices.repository.ts` | 110 | PENDING |
| `src/server/modules/invoices/invoices.service.ts` | 350 | OUTLINED |
| `src/server/modules/invoices/tax-config.ts` | 39 | READ |
| `src/server/modules/invoices/timezone.ts` | 41 | PENDING |
| `src/server/modules/memberships/membership-gate.ts` | 82 | READ |
| `src/server/modules/memberships/membership-plans.repository.ts` | 32 | PENDING |
| `src/server/modules/memberships/membership-plans.service.ts` | 65 | PENDING |
| `src/server/modules/memberships/memberships.controller.ts` | 110 | PENDING |
| `src/server/modules/memberships/memberships.dto.ts` | 26 | PENDING |
| `src/server/modules/memberships/memberships.repository.ts` | 112 | PENDING |
| `src/server/modules/memberships/memberships.service.ts` | 214 | OUTLINED |
| `src/server/modules/memberships/plan-tiers.ts` | 45 | PENDING |
| `src/server/modules/memberships/region.ts` | 72 | OUTLINED |
| `src/server/modules/memberships/visibility-boost.ts` | 120 | PENDING |
| `src/server/modules/moderation/moderation.controller.ts` | 45 | PENDING |
| `src/server/modules/moderation/moderation.service.ts` | 149 | OUTLINED |
| `src/server/modules/notifications/notifications.controller.ts` | 62 | PENDING |
| `src/server/modules/notifications/notifications.dto.ts` | 35 | PENDING |
| `src/server/modules/notifications/notifications.repository.ts` | 155 | PENDING |
| `src/server/modules/notifications/notifications.service.ts` | 204 | OUTLINED |
| `src/server/modules/notifications/providers/dev.provider.ts` | 64 | PENDING |
| `src/server/modules/notifications/providers/email.provider.ts` | 24 | PENDING |
| `src/server/modules/notifications/providers/factory.ts` | 33 | PENDING |
| `src/server/modules/notifications/providers/push.provider.ts` | 120 | OUTLINED |
| `src/server/modules/notifications/providers/types.ts` | 44 | PENDING |
| `src/server/modules/notifications/providers/whatsapp.provider.ts` | 70 | PENDING |
| `src/server/modules/otp/otp-config.controller.ts` | 47 | PENDING |
| `src/server/modules/otp/otp-config.repository.ts` | 36 | PENDING |
| `src/server/modules/otp/otp-config.service.ts` | 125 | READ |
| `src/server/modules/otp/otp-provider.controller.ts` | 23 | PENDING |
| `src/server/modules/otp/otp-provider.service.ts` | 116 | READ |
| `src/server/modules/otp/otp.repository.ts` | 155 | READ |
| `src/server/modules/otp/otp.service.ts` | 342 | READ |
| `src/server/modules/otp/otp.types.ts` | 21 | PENDING |
| `src/server/modules/otp/providers/destination.ts` | 70 | READ |
| `src/server/modules/otp/providers/dev.provider.ts` | 71 | READ |
| `src/server/modules/otp/providers/email.provider.ts` | 47 | READ |
| `src/server/modules/otp/providers/factory.ts` | 33 | READ |
| `src/server/modules/otp/providers/sms.provider.ts` | 87 | READ |
| `src/server/modules/otp/providers/types.ts` | 44 | PENDING |
| `src/server/modules/otp/providers/whatsapp.provider.ts` | 29 | READ |
| `src/server/modules/payments/credentials.ts` | 107 | PENDING |
| `src/server/modules/payments/dev-mode.ts` | 14 | READ |
| `src/server/modules/payments/gateways.controller.ts` | 77 | PENDING |
| `src/server/modules/payments/gateways.repository.ts` | 87 | PENDING |
| `src/server/modules/payments/gateways.service.ts` | 210 | PENDING |
| `src/server/modules/payments/payment-config.controller.ts` | 74 | PENDING |
| `src/server/modules/payments/payment-config.service.ts` | 247 | PENDING |
| `src/server/modules/payments/payments-pcp.repository.ts` | 129 | PENDING |
| `src/server/modules/payments/payments.controller.ts` | 115 | PENDING |
| `src/server/modules/payments/payments.dto.ts` | 37 | PENDING |
| `src/server/modules/payments/payments.repository.ts` | 183 | PENDING |
| `src/server/modules/payments/payments.service.ts` | 504 | READ |
| `src/server/modules/payments/providers/cashfree.provider.ts` | 44 | OUTLINED |
| `src/server/modules/payments/providers/dev.provider.ts` | 151 | PENDING |
| `src/server/modules/payments/providers/factory.ts` | 52 | PENDING |
| `src/server/modules/payments/providers/http.ts` | 68 | PENDING |
| `src/server/modules/payments/providers/paytm.provider.ts` | 44 | PENDING |
| `src/server/modules/payments/providers/payu.provider.ts` | 43 | PENDING |
| `src/server/modules/payments/providers/phonepe.provider.ts` | 229 | PENDING |
| `src/server/modules/payments/providers/razorpay.provider.ts` | 185 | OUTLINED |
| `src/server/modules/payments/providers/types.ts` | 137 | PENDING |
| `src/server/modules/payments/razorpay-confirm.controller.ts` | 26 | PENDING |
| `src/server/modules/payments/razorpay-confirm.service.ts` | 71 | PENDING |
| `src/server/modules/payments/razorpay-resume.controller.ts` | 15 | PENDING |
| `src/server/modules/payments/razorpay-resume.service.ts` | 63 | PENDING |
| `src/server/modules/payments/refunds.controller.ts` | 37 | PENDING |
| `src/server/modules/payments/refunds.service.ts` | 211 | OUTLINED |
| `src/server/modules/payments/webhooks.controller.ts` | 21 | PENDING |
| `src/server/modules/payments/webhooks.service.ts` | 236 | OUTLINED |
| `src/server/modules/platform-settings/platform-settings.controller.ts` | 99 | PENDING |
| `src/server/modules/platform-settings/platform-settings.repository.ts` | 23 | PENDING |
| `src/server/modules/platform-settings/platform-settings.service.ts` | 440 | OUTLINED |
| `src/server/modules/preferences/preferences.controller.ts` | 75 | PENDING |
| `src/server/modules/preferences/preferences.dto.ts` | 70 | PENDING |
| `src/server/modules/preferences/preferences.repository.ts` | 44 | PENDING |
| `src/server/modules/preferences/preferences.service.ts` | 148 | OUTLINED |
| `src/server/modules/profiles/approval.controller.ts` | 27 | PENDING |
| `src/server/modules/profiles/approval.service.ts` | 131 | OUTLINED |
| `src/server/modules/profiles/completion.ts` | 71 | OUTLINED |
| `src/server/modules/profiles/privacy.ts` | 74 | READ |
| `src/server/modules/profiles/profiles.controller.ts` | 291 | PENDING |
| `src/server/modules/profiles/profiles.dto.ts` | 266 | OUTLINED |
| `src/server/modules/profiles/profiles.repository.ts` | 151 | PENDING |
| `src/server/modules/profiles/profiles.service.ts` | 799 | OUTLINED |
| `src/server/modules/profiles/reference.repository.ts` | 231 | PENDING |
| `src/server/modules/recommendations/behaviour-signal.ts` | 134 | OUTLINED |
| `src/server/modules/recommendations/real-behaviour-signal-provider.ts` | 180 | OUTLINED |
| `src/server/modules/recommendations/recommendations.controller.ts` | 55 | OUTLINED |
| `src/server/modules/recommendations/recommendations.dto.ts` | 84 | OUTLINED |
| `src/server/modules/recommendations/recommendations.repository.ts` | 116 | OUTLINED |
| `src/server/modules/recommendations/recommendations.service.ts` | 255 | OUTLINED |
| `src/server/modules/recommendations/scoring.ts` | 518 | OUTLINED |
| `src/server/modules/recommendations/weights.controller.ts` | 54 | OUTLINED |
| `src/server/modules/recommendations/weights.repository.ts` | 39 | OUTLINED |
| `src/server/modules/recommendations/weights.service.ts` | 140 | PENDING |
| `src/server/modules/reports/reports.controller.ts` | 141 | PENDING |
| `src/server/modules/reports/reports.repository.ts` | 199 | PENDING |
| `src/server/modules/reports/reports.service.ts` | 278 | OUTLINED |
| `src/server/modules/search/age-range.ts` | 45 | PENDING |
| `src/server/modules/search/search.controller.ts` | 218 | PENDING |
| `src/server/modules/search/search.repository.ts` | 160 | READ |
| `src/server/modules/search/search.service.ts` | 170 | READ |
| `src/server/modules/staff/bootstrap-super-admin.ts` | 59 | READ |
| `src/server/modules/staff/staff.controller.ts` | 106 | PENDING |
| `src/server/modules/staff/staff.service.ts` | 342 | READ |
| `src/server/modules/storage/factory.ts` | 47 | OUTLINED |
| `src/server/modules/storage/image-inspect.ts` | 97 | OUTLINED |
| `src/server/modules/storage/local-disk.provider.ts` | 66 | OUTLINED |
| `src/server/modules/storage/s3.provider.ts` | 159 | OUTLINED |
| `src/server/modules/storage/storage-key.ts` | 18 | OUTLINED |
| `src/server/modules/storage/storage.types.ts` | 32 | PENDING |
| `src/server/modules/users/users.controller.ts` | 10 | READ |
| `src/server/modules/users/users.dto.ts` | 35 | READ |
| `src/server/modules/users/users.repository.ts` | 44 | READ |
| `src/server/modules/users/users.service.ts` | 16 | READ |
| `src/server/modules/warnings/warnings.controller.ts` | 75 | PENDING |
| `src/server/modules/warnings/warnings.repository.ts` | 62 | PENDING |
| `src/server/modules/warnings/warnings.service.ts` | 118 | OUTLINED |

### B9-ops

| File | Lines | Status |
|---|---|---|
| `scripts-smoke-otp.ts` | 46 | READ |
| `scripts/backup-db.sh` | 174 | PENDING |
| `scripts/backup-offsite.ts` | 119 | PENDING |
| `scripts/backup-secure.sh` | 159 | PENDING |
| `scripts/check-prod-env.ts` | 66 | PENDING |
| `scripts/check-providers.ts` | 130 | PENDING |
| `scripts/create-super-admin.ts` | 35 | PENDING |
| `scripts/create-test-db.cjs` | 31 | PENDING |
| `scripts/deploy.sh` | 82 | OUTLINED |
| `scripts/dev-tools.ts` | 410 | PENDING |
| `scripts/disable-admin-mfa.ts` | 28 | PENDING |
| `scripts/git-hooks/pre-commit` | 3 | READ |
| `scripts/lib/secret-scan.ts` | 123 | PENDING |
| `scripts/restore-db.sh` | 51 | PENDING |
| `scripts/run-job.ts` | 33 | PENDING |
| `scripts/scan-secrets.ts` | 60 | PENDING |
| `scripts/seed-perf-data.ts` | 354 | PENDING |
| `scripts/smoke/b18-smoke.ts` | 350 | PENDING |
| `scripts/smoke/b18-ui-check.ts` | 306 | PENDING |
| `scripts/smoke/b19-smoke.ts` | 203 | PENDING |
| `scripts/smoke/lib.ts` | 101 | PENDING |
| `scripts/smoke/pcp-gateway-smoke.ts` | 248 | PENDING |
| `scripts/smoke/pcp-prod-smoke.ts` | 366 | PENDING |
| `scripts/smoke/pcp-ui-check.ts` | 317 | PENDING |
| `scripts/smoke/pcp-ui-gateway-check.ts` | 296 | PENDING |
| `scripts/smoke/run-smoke.sh` | 113 | OUTLINED |
| `scripts/verify-restore.sh` | 93 | PENDING |

### B9-tests

| File | Lines | Status |
|---|---|---|
| `tests/admin-audit-logs.test.ts` | 181 | PENDING |
| `tests/admin-dashboard.test.ts` | 172 | PENDING |
| `tests/admin-invoices-list.test.ts` | 232 | PENDING |
| `tests/admin-users.test.ts` | 215 | PENDING |
| `tests/auth-forgot-password.test.ts` | 129 | PENDING |
| `tests/auth-login.test.ts` | 142 | PENDING |
| `tests/auth-otp-login-device.test.ts` | 126 | PENDING |
| `tests/auth-register.test.ts` | 178 | PENDING |
| `tests/b16-integration.test.ts` | 170 | PENDING |
| `tests/b18-communities.test.ts` | 118 | PENDING |
| `tests/b18-escalation.test.ts` | 169 | PENDING |
| `tests/b18-member-settings.test.ts` | 313 | PENDING |
| `tests/b18-otp-policy.test.ts` | 319 | PENDING |
| `tests/b18-permission-matrix.test.ts` | 253 | PENDING |
| `tests/b18-plans.test.ts` | 151 | PENDING |
| `tests/b18-reconcile.test.ts` | 70 | PENDING |
| `tests/b18-search.test.ts` | 267 | PENDING |
| `tests/b18-security-events.test.ts` | 90 | PENDING |
| `tests/b19-admin-mfa.test.ts` | 169 | PENDING |
| `tests/b19-chat-stream.test.ts` | 176 | PENDING |
| `tests/b19-contact-change.test.ts` | 126 | OUTLINED |
| `tests/b19-content.test.ts` | 147 | PENDING |
| `tests/b19-dashboard-security.test.ts` | 145 | PENDING |
| `tests/b19-digest.test.ts` | 177 | PENDING |
| `tests/b19-dunning.test.ts` | 110 | PENDING |
| `tests/b19-groups.test.ts` | 233 | PENDING |
| `tests/b19-site-controls.test.ts` | 187 | PENDING |
| `tests/behaviour-events.test.ts` | 257 | PENDING |
| `tests/chat.test.ts` | 354 | PENDING |
| `tests/db.test.ts` | 125 | PENDING |
| `tests/error-handling.test.ts` | 61 | PENDING |
| `tests/gateways.test.ts` | 149 | PENDING |
| `tests/health-ready.test.ts` | 74 | PENDING |
| `tests/health.test.ts` | 17 | PENDING |
| `tests/helpers/mock-gateways.ts` | 250 | PENDING |
| `tests/helpers/mock-notify.ts` | 77 | PENDING |
| `tests/helpers/mock-otp.ts` | 125 | PENDING |
| `tests/helpers/moto-bootstrap.py` | 30 | PENDING |
| `tests/helpers/pcp.ts` | 69 | PENDING |
| `tests/helpers/presign-ref.py` | 37 | PENDING |
| `tests/helpers/profile-fixtures.ts` | 287 | PENDING |
| `tests/helpers/reset-db.ts` | 237 | PENDING |
| `tests/helpers/rl-worker.ts` | 15 | PENDING |
| `tests/helpers/run-tsx.ts` | 37 | PENDING |
| `tests/interactions.test.ts` | 558 | OUTLINED |
| `tests/invoice-resend.test.ts` | 159 | PENDING |
| `tests/invoices.test.ts` | 249 | PENDING |
| `tests/logger-redaction.test.ts` | 26 | PENDING |
| `tests/membership-plans.test.ts` | 98 | PENDING |
| `tests/memberships.test.ts` | 248 | PENDING |
| `tests/mobile-integration.test.ts` | 360 | OUTLINED |
| `tests/notifications-production-guard.test.ts` | 45 | PENDING |
| `tests/notifications.test.ts` | 325 | PENDING |
| `tests/otp-config.test.ts` | 141 | PENDING |
| `tests/otp-core.test.ts` | 215 | PENDING |
| `tests/otp-production-guard.test.ts` | 47 | PENDING |
| `tests/partner-preferences.test.ts` | 191 | PENDING |
| `tests/payments-production-guard.test.ts` | 81 | PENDING |
| `tests/payments.test.ts` | 288 | PENDING |
| `tests/pcp-account.test.ts` | 458 | PENDING |
| `tests/pcp-backup.test.ts` | 283 | OUTLINED |
| `tests/pcp-bootstrap-admin.test.ts` | 94 | PENDING |
| `tests/pcp-foundation.test.ts` | 225 | PENDING |
| `tests/pcp-jobs.test.ts` | 391 | PENDING |
| `tests/pcp-notifications.test.ts` | 171 | PENDING |
| `tests/pcp-otp-prod-guard.test.ts` | 47 | PENDING |
| `tests/pcp-otp.test.ts` | 298 | PENDING |
| `tests/pcp-payments-prod-guard.test.ts` | 42 | PENDING |
| `tests/pcp-payments-resume.test.ts` | 196 | PENDING |
| `tests/pcp-payments.test.ts` | 640 | PENDING |
| `tests/pcp-provider-setup.test.ts` | 263 | PENDING |
| `tests/pcp-security.test.ts` | 428 | PENDING |
| `tests/pcp-storage.test.ts` | 207 | OUTLINED |
| `tests/perf-query-counts.test.ts` | 179 | OUTLINED |
| `tests/performance-concurrency.test.ts` | 131 | PENDING |
| `tests/performance-load.test.ts` | 307 | OUTLINED |
| `tests/performance-pagination-stability.test.ts` | 227 | PENDING |
| `tests/performance-redundant-indexes.test.ts` | 141 | PENDING |
| `tests/prod-readiness.test.ts` | 130 | PENDING |
| `tests/profile-summaries.test.ts` | 177 | PENDING |
| `tests/profiles-photos.test.ts` | 208 | PENDING |
| `tests/profiles-public-view.test.ts` | 157 | PENDING |
| `tests/profiles-reference-options.test.ts` | 43 | PENDING |
| `tests/profiles-update-completion.test.ts` | 138 | PENDING |
| `tests/profiles-verification.test.ts` | 125 | PENDING |
| `tests/push-tokens.test.ts` | 264 | PENDING |
| `tests/qa-boundary-conditions.test.ts` | 145 | PENDING |
| `tests/qa-enumeration-resistance.test.ts` | 121 | PENDING |
| `tests/qa-interactions-and-rbac-gaps.test.ts` | 146 | PENDING |
| `tests/rbac.test.ts` | 142 | PENDING |
| `tests/recommendations.test.ts` | 1001 | PENDING |
| `tests/registration-otp-switch-smtp.test.ts` | 129 | PENDING |
| `tests/registration-otp-switch.test.ts` | 314 | PENDING |
| `tests/reports.test.ts` | 430 | PENDING |
| `tests/run-tsx.test.ts` | 29 | PENDING |
| `tests/search-profiles.test.ts` | 321 | PENDING |
| `tests/secret-scan.test.ts` | 91 | PENDING |
| `tests/security-concurrency.test.ts` | 186 | PENDING |
| `tests/security-regression.test.ts` | 404 | PENDING |
| `tests/setup.ts` | 104 | PENDING |
| `tests/smoke.test.ts` | 294 | PENDING |
| `tests/visibility-boost.test.ts` | 219 | PENDING |

### CONFIG

| File | Lines | Status |
|---|---|---|
| `.env.example` | 212 | PENDING |
| `.env.test.example` | 22 | PENDING |
| `.eslintrc.json` | 3 | READ |
| `.gitignore` | 72 | READ |
| `.secretscan-allow` | 2 | READ |
| `.tsconfig-gate1-check.json` | 4 | READ |
| `drizzle.config.ts` | 17 | READ |
| `next-env.d.ts` | 5 | PENDING |
| `next.config.js` | 67 | READ |
| `package-lock.json` | 10001 | PENDING |
| `package.json` | 69 | READ |
| `postcss.config.js` | 6 | READ |
| `tailwind.config.ts` | 98 | PENDING |
| `tsconfig.json` | 22 | READ |
| `vitest.config.ts` | 26 | READ |

### DOC

| File | Lines | Status |
|---|---|---|
| `API_REFERENCE.md` | 873 | PENDING |
| `B15_FINAL_REPORT.md` | 152 | PENDING |
| `B15_KNOWN_LIMITATIONS.md` | 30 | PENDING |
| `B15_RELEASE_CHECKLIST.md` | 27 | PENDING |
| `B15_RELEASE_READINESS_MATRIX.md` | 46 | PENDING |
| `B16_AUDIT.md` | 412 | PENDING |
| `B16_FINAL_REPORT.md` | 103 | PENDING |
| `B16_PRODUCTION_INFRASTRUCTURE.md` | 351 | PENDING |
| `B16_RELEASE_READINESS.md` | 72 | PENDING |
| `B18_AUDIT.md` | 71 | PENDING |
| `B18_FINAL_REPORT.md` | 209 | OUTLINED |
| `B18_KNOWN_LIMITATIONS.md` | 75 | OUTLINED |
| `B18_PERMISSION_MATRIX.md` | 109 | PENDING |
| `B18_RELEASE_READINESS_MATRIX.md` | 34 | PENDING |
| `B19_FINAL_REPORT.md` | 80 | PENDING |
| `B19_KNOWN_LIMITATIONS.md` | 57 | OUTLINED |
| `B19_RELEASE_READINESS_MATRIX.md` | 23 | PENDING |
| `BACKEND.md` | 6870 | PENDING |
| `BACKUP_DR.md` | 266 | PENDING |
| `DEPLOYMENT.md` | 139 | PENDING |
| `DEPLOYMENT_PRODUCTION.md` | 116 | PENDING |
| `FAST2SMS_SETUP.md` | 47 | PENDING |
| `FINAL_HANDOVER.md` | 92 | READ |
| `GIT_HANDOVER.md` | 33 | READ |
| `LOCAL_SETUP.md` | 285 | PENDING |
| `PAYMENT_SETUP.md` | 90 | PENDING |
| `PCP_FINAL_REPORT.md` | 67 | PENDING |
| `PCP_KNOWN_LIMITATIONS.md` | 57 | OUTLINED |
| `PCP_RELEASE_READINESS_MATRIX.md` | 60 | PENDING |
| `PERFORMANCE_REPORT.md` | 820 | OUTLINED |
| `PRODUCTION_COMPLETION_AUDIT.md` | 206 | PENDING |
| `PRODUCTION_ENV_REFERENCE.md` | 97 | PENDING |
| `PROJECT_MEMORY.md` | 61 | READ |
| `PROVIDER_TEST_SETUP.md` | 101 | PENDING |
| `QA_TRACEABILITY_MATRIX.md` | 597 | OUTLINED |
| `README.md` | 74 | READ |
| `SECURITY_RELEASE_CHECKLIST.md` | 26 | PENDING |
| `docs/B16_FINAL_HANDOVER_ARCHIVE.md` | 226 | PENDING |
| `docs/DECISIONS_AND_CHANGELOG.md` | 61 | READ |
| `docs/FRONTEND_BACKEND_ARCHITECTURE.md` | 276 | READ |
| `docs/phase-status/backend-b1-status.md` | 135 | PENDING |
| `docs/phase-status/backend-b10-status.md` | 47 | PENDING |
| `docs/phase-status/backend-b11-status.md` | 41 | PENDING |
| `docs/phase-status/backend-b12-status.md` | 27 | PENDING |
| `docs/phase-status/backend-b13-status.md` | 46 | PENDING |
| `docs/phase-status/backend-b14-status.md` | 70 | PENDING |
| `docs/phase-status/backend-b15-status.md` | 49 | PENDING |
| `docs/phase-status/backend-b16-status.md` | 65 | PENDING |
| `docs/phase-status/backend-b16b-status.md` | 25 | PENDING |
| `docs/phase-status/backend-b2-status.md` | 153 | PENDING |
| `docs/phase-status/backend-b3-status.md` | 170 | PENDING |
| `docs/phase-status/backend-b4-status.md` | 158 | PENDING |
| `docs/phase-status/backend-b5-status.md` | 138 | PENDING |
| `docs/phase-status/backend-b6-status.md` | 40 | PENDING |
| `docs/phase-status/backend-b7-status.md` | 35 | PENDING |
| `docs/phase-status/backend-b8-status.md` | 55 | PENDING |
| `docs/phase-status/backend-b9-status.md` | 42 | PENDING |
| `docs/phase-status/frontend-phase1-status.md` | 399 | PENDING |
