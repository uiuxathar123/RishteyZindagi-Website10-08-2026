# RishteyZindagi Frontend — Build Status (Phase 1 + Phase 2 + Phase 2.1 + Phase 2.2 + Phase 2.3 + Phase 2.4)

**Last updated:** 2026-09-15
**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS for web; native (React Native/Kotlin) planned for the eventual Android app.

## Phase 1 — Design System + Public Website (done)

The full public marketing site + design system + component library. See
"What exists" below — later phases extended rather than replaced any of it.

## Phase 2 — Member Dashboard + Staff Admin Panel + Blog + font upgrade (done)

Delivered as an update to the same `rishteyzindagi-web/` project (re-zipped
and re-sent to the user). Added:

- **Self-hosted fonts**: replaced the Google Fonts `<link>` tag (which
  depended on a live request to fonts.googleapis.com/fonts.gstatic.com at
  runtime) with `next/font/local` + bundled `.woff2` files in
  `src/app/fonts/` (Playfair Display for headings, DM Sans for body — pulled
  from the `@fontsource` npm distribution, OFL-licensed, license files kept
  alongside). Builds and renders correctly with zero network dependency —
  verified this fixes rendering even in this sandbox, which previously fell
  back to system fonts.
- **Route restructuring**: root `src/app/layout.tsx` is now a bare shell
  (fonts + `<html>/<body>` only). All Phase 1 public routes moved under a
  new `src/app/(marketing)/` route group with their own layout (Header +
  Footer + skip-link) — URLs unchanged. This was necessary so the new
  `/dashboard` and `/admin` shells don't inherit the public nav.
- **Member Dashboard** (`/dashboard/*`, `src/components/dashboard/`,
  `src/services/dashboardService.ts`, `src/data/{currentUser,interests,
  conversations,notifications}.ts`): Overview, My Profile (tabbed editor),
  Matches, Interests (Received/Sent with live Accept/Decline), Shortlist,
  Messages (real two-pane chat, working send), Notifications, Membership
  (upgrade grid via existing `PlanCard`), Settings (Account/Privacy/
  Notifications/Danger Zone). Own sidebar+topbar shell, cream/ivory surface,
  maroon accent. `LoginForm` and `SignupFlow` now route into it for real
  (`/login` submit → `/dashboard`; signup's last step → `/dashboard/profile`)
  — the flow is walkable end-to-end, not a dead end.
- **Staff Admin Panel** (`/admin/*`, `src/components/admin/`,
  `src/services/adminService.ts`, `src/data/{adminUsers,pendingApprovals,
  reports}.ts`): Overview (KPIs + recent signups), Users (search/filter +
  live Verify/Suspend), Profile Approvals (live Approve/Reject), Reports
  (Open/Resolved tabs + live Resolve), Settings. Own sidebar+topbar shell,
  dark navy surface, gold accent (deliberately distinct from both the
  public site and the member dashboard), `noindex`. Not linked from the
  public site — reached by URL, like a real back office.
- **Blog** (`/blog`, `/blog/[slug]`, inside `(marketing)`,
  `src/services/blogService.ts`, `src/data/blogPosts.ts`): 6 full,
  substantive articles (not lorem ipsum) on-brand for the India/NRI
  matrimonial audience. Linked from the main nav and footer.
- **New shared UI primitives**: `src/components/ui/Toggle.tsx` (accessible
  switch) and `src/components/ui/Tabs.tsx` (tab strip) — used throughout
  both new sections.
- Build process: two parallel subagents built Dashboard and Admin+Blog
  independently against a shared, pre-written conventions brief (tokens,
  component APIs, file-ownership boundaries) to avoid collisions, then the
  orchestrating session wired navigation, ran full `tsc`/`next build`,
  fixed the `services/README.md` merge, and did Playwright QA (zero
  horizontal overflow at 1440/768/375px across every route, including all
  new screens) plus a visual screenshot review before shipping.

## Phase 2.1 — Super Admin (done)

The highest-privilege tier, above Staff Admin — added inside the same
Admin Panel shell rather than a separate app, per the user's choice
(`/admin/super/*`), with a distinct "SUPER ADMIN" nav group (crown icon,
gold divider) so it never reads as an ordinary Staff Admin page. Real
role-based access control that actually *hides* this group from
non-super-admin staff is a backend/session integration point — same
caveat as the rest of the Admin Panel, which has no real auth yet.

- **`/admin/super`** — Super Overview: staff-account count, total revenue,
  refunded amount, logged-action count, plus quick-link cards into the
  four sections below.
- **`/admin/super/staff`** (`StaffClient.tsx`) — the internal staff
  directory: search-free table of every staff/admin/super-admin account,
  an "Add Staff Member" inline invite form (name/email/role), a per-row
  role `<Select>` (Staff/Admin/Super Admin) that updates live, and a
  per-row Disable/Enable action.
- **`/admin/super/settings`** (`PlatformSettingsClient.tsx`) — platform-
  level switches distinct from the Staff Admin Settings screen: payment
  gateway select (Razorpay/Cashfree/PayU/PhonePe/Paytm), OTP channel
  select (SMS/WhatsApp/Email), and four feature-flag Toggles (Smart
  Matching, Video call introductions, Horoscope matching, NRI priority
  search).
- **`/admin/super/revenue`** — KPI cards (total revenue, successful/failed
  transaction counts, refunded amount), a revenue-by-plan breakdown table,
  and a recent-transactions table (10 mock transactions across 5
  gateways).
- **`/admin/super/audit-log`** (`AuditLogClient.tsx`) — the accountability
  trail: 12 mock log entries (verify/suspend/approve/reject/resolve/
  settings-change/staff actions) with actor, role badge, target, and
  timestamp, filterable by actor role.
- New data/service files: `src/data/{staffAccounts,transactions,auditLog,
  platformConfig}.ts` + `src/services/superAdminService.ts` (same async-
  over-mock-data contract as every other service).
- Verified: `tsc --noEmit` clean, `next build` succeeds (45 static pages
  total), zero horizontal overflow at 1440px/375px across all 5 new
  routes, visual screenshot review passed.

## Phase 2.2 — OTP email-only, live checkout, Religion/Caste data (done)

A three-part follow-up request: (1) make Super Admin's existing staff/role
management the whole story for who can manage the site — reinforced, not
re-architected, since Phase 2.1 already built it; (2) OTP restricted to
Email and controlled from Super Admin; (3) Super Admin's payment-gateway
selection wired to an actual, visible checkout flow; (4) a user-supplied
Religion/Caste/Surname Excel dataset incorporated as selectable data.

- **OTP is now Email-only, Super Admin-controlled**:
  `PLATFORM_CONFIG.otpChannel` (`src/data/platformConfig.ts`) defaults to
  `"Email"` (was `"WhatsApp"`) — still changeable from
  `/admin/super/settings`'s existing OTP channel select. A new
  `describeOtpChannel()` helper in the same file turns whichever channel is
  active into field label / input type / placeholder / copy, consumed by
  both `LoginForm.tsx` (OTP-mode identifier field + explanatory text) and
  `SignupFlow.tsx` (OTP step heading + body: "Verify your email address...
  a 4-digit verification code... to your email address"). No component
  hard-codes "email" or "mobile number" independently — both read the one
  active channel, so changing Super Admin's selection changes the copy
  everywhere at once (on next render; there's no live cross-tab config
  push yet, same caveat as every other mock-config screen in this project).
- **Membership checkout, wired to Super Admin's gateway selection**:
  `/membership/checkout?plan=<id>` (`src/app/(marketing)/membership/
  checkout/page.tsx`, server component + `CheckoutClient.tsx`) — the route
  `PlanCard` already linked to but which didn't exist. Reads
  `PLATFORM_CONFIG.paymentGateway` via `superAdminService.getPlatformConfig()`
  and shows that *one* gateway as the payment method (never a member-facing
  picker — matches the "Super Admin manually selects the gateway" ask
  exactly). Order summary + a "Pay ₹X via <Gateway>" button that simulates
  a processing → verified-success round-trip (no real gateway SDK/webhook;
  a `setTimeout` stands in, consistent with the "membership only activates
  after backend verification" language already on the `/membership` FAQ).
  Success state links to `/dashboard/membership`.
- **Religion → Community/Caste data**, from the user-uploaded
  `India_Religion_Caste_Surname_Data.xlsx` (34 rows across Muslim, Hindu,
  Sikh, Christian, Jain, Buddhist; Sect/Group → Caste/Biradari/Sub-group →
  common surnames):
  - `src/data/communityData.ts` — typed `COMMUNITY_DATA` tree
    (Religion → Sect → Group, each group carrying surnames), plus
    `RELIGIONS` / `RELIGIONS_WITH_COMMUNITY` and lookup helpers
    (`getCommunitySects`, `getCommunityGroupById`). Only the neutral
    structural columns are exposed — the source dataset's "Notes" column
    (class/reservation-category commentary like "Upper class", "OBC",
    "Historically disadvantaged") is deliberately **not** shown as UI copy,
    kept only as code comments on each group; this was a self-directed
    tastefulness call (matches how real matrimonial platforms expose a
    neutral "Community" field), not an explicit user instruction. Per the
    source file, Ahmadiyya was excluded at the original compiler's request.
  - `src/components/community/CommunityOptionGroups.tsx` (grouped
    `<optgroup>` renderer) and `ReligionCommunityFields.tsx` (a cascading
    Religion+Community field pair — internal `useState`, but renders plain
    named `<select>`s so it drops into an ordinary GET `<form>` with no
    other changes).
  - First wired into `FilterPanel.tsx` (search filters), the homepage
    `Hero` search widget, and `ProfileEditor.tsx` — **the `Hero` placement
    was reverted in Phase 2.3 below**, see there for the current state.
  - `Profile` (`src/data/profiles.ts`) and `CurrentUser`
    (`src/data/currentUser.ts`) both gained an optional/`community` field;
    the 6 mock profiles and the demo current-user got a plausible
    community assigned (`profileService.search()` now also filters on
    `community`).
- Verified: `tsc --noEmit` clean, `next build` succeeds (46 routes: the
  new `/membership/checkout` is a dynamic route alongside `/search`,
  everything else still static), Playwright zero-horizontal-overflow check
  at 1440/768/375px on home/checkout/search/profile-editor/signup/login,
  and a full visual screenshot pass — all reviewed and correct.

## Phase 2.3 — Community off the homepage, gated profiles for visitors (done)

Two follow-up fixes from the user, in Hinglish: (1) the homepage hero
search widget shouldn't ask Community/Caste — that belongs at account
creation instead; (2) showing real member profiles (photo, name) to an
anonymous visitor is inappropriate — only a logged-in member should see
full profile data. Clarified via AskUserQuestion which gating approach to
build; the user picked "gate only profiles, keep marketing pages public."

- **Community/Caste moved off the homepage, onto Signup**: `Hero.tsx`
  reverted to a plain Religion-only `<Select>` (sourced from
  `RELIGIONS` in `communityData.ts`, no cascading Community field, no
  `ReligionCommunityFields`/`Users`-icon imports). `SignupFlow.tsx`'s
  Basic Details step (step 0) now includes `<ReligionCommunityFields
  idPrefix="su" />` alongside name/gender/DOB/mobile/email — Community is
  asked once, at signup, not on the public search widget. `FilterPanel`
  (the `/search` filters) keeps its own Religion+Community fields
  unchanged — that's a real search refinement, not the marketing landing
  page.
- **Anonymous visitors never see real member profiles**: `ProfileCard`
  (`src/components/profile/ProfileCard.tsx`) gained a `gated` prop.
  `gated` renders: photo blurred (`blur-lg`) with a lock-icon overlay
  (verified badge still shown — not identifying), no name (replaced with
  "Member Profile"), only generic age/city/education/profession, and the
  Interest/Chat buttons replaced with **Login** / **Sign Up Free**
  buttons linking to `/login` and `/signup`. `FeaturedProfiles.tsx`
  (homepage) and `/search`'s results grid always pass `gated` — both are
  public `(marketing)` pages, so every visitor there is anonymous. The
  dashboard's own screens (`dashboard/matches`, `dashboard/page.tsx`) pass
  nothing and render the full card exactly as before — that's a logged-in
  member viewing their own matches, which the user explicitly said is
  fine ("hum user hai aur woh profile dekhra hai tu thik hai"). There's no
  real session in this phase, so which variant renders is a **fixed
  per-page choice** (public pages = always gated, dashboard = always
  full), not a read of actual auth state — a real session/auth layer
  should make this decision server-side per request instead; documented
  as the next integration point in the doc comment on `ProfileCard` and in
  `src/services/README.md`.
- Verified: `tsc --noEmit` clean, `next build` succeeds (still 46 routes),
  Playwright screenshot review of home (header present, no Community field
  in Hero, zero overflow), `/search` (all 6 results correctly gated —
  blurred photo, "Member Profile", Login/Sign Up buttons), and `/signup`
  (Religion + Community fields render correctly in Basic Details) — all
  reviewed and correct.
- Note on session tooling: this phase's build-check tool went temporarily
  unavailable mid-session for several hours (a sandbox-side outage, not a
  project issue) — handled by scheduling background retries
  (`send_later`) rather than blocking the user, with a status update sent
  when it recurred. Once the tool recovered, `tsc`/`build`/QA all ran
  clean on the first try — no code issues were hidden by the delay.

## Phase 2.4 — Global Header & Footer rebuild ("Task 17") (done)

A detailed spec from the user asking for the global `<Header />`/
`<Footer />` to be reinstated/rebuilt to a specific brand design —
exact nav order, a four-column footer, a trust strip, honest app-
promotion copy, and a long accessibility/QA checklist across six named
breakpoints. Investigation first confirmed the architectural requirement
("must not be recreated per page") was **already true**: both components
already lived in `src/components/layout/` and were already mounted
exactly once, in `src/app/(marketing)/layout.tsx` — no page had its own
copy. The actual gaps were in content and a11y polish, not architecture:

- **Header** (`src/components/layout/Header.tsx`) — nav reordered to
  match the spec exactly (Home, How It Works, Search, Membership,
  Success Stories, Safety, About), with **Blog kept as an 8th item**
  rather than removed — it's real, substantive content built in Phase 2,
  and the brief never said to take it down, only that its list of primary
  items didn't include it. Added: body-scroll-lock while the mobile
  drawer is open, Escape-to-close (returns focus to the hamburger
  button), click-outside-to-close, and focus-first-link-on-open. Reduced
  motion needed no new code — `globals.css`'s existing
  `prefers-reduced-motion` rule already zeroes `transition-duration` on
  every element, which covers the drawer's `transition-[max-height]`.
  Documented (in a doc comment on `Header`) why there's no authenticated-
  CTA toggle inside the component itself: `/dashboard/*` and `/admin/*`
  never mount the public `Header` at all — they have their own shells —
  so "authenticated users see the real nav, not Login/Create Profile" is
  already true by construction, with no second auth system added, per the
  brief's explicit constraint.
- **Footer** (`src/components/layout/Footer.tsx`) — rebuilt from 3
  columns to the spec's 4: **Quick Links** (Home…FAQ, plus Blog appended
  for the same reason as the header), **Matrimonial** (Browse Profiles →
  `/search`; Recommended Profiles and Partner Preferences → `/signup`,
  since those are member-account features with no public equivalent to
  link to; Success Stories → `/success-stories`; India Matrimony →
  `/search?country=India`; NRI Matrimony → `/search` unfiltered, since
  the real search filter only matches one exact country at a time — there
  is no single "NRI" value to filter on honestly), and **Support**
  (Contact Us, Help & Support → `/faq`, Privacy/Terms/Refund). Added a
  trust strip (Verified Profiles / Privacy Focused / India + NRI
  Connections / Secure Platform) and an app-promotion section — which
  deliberately shows a plain **"Android App — Coming Soon"** label
  instead of a clickable Play Store badge, since no real store listing or
  URL exists anywhere in this project (the native app is still listed
  under "what's intentionally still not in this phase" below); inventing
  a working-looking link there would have been misleading, which the
  brief explicitly warned against. Bottom bar now repeats Privacy/Terms/
  Refund links alongside the existing phone/email, and the copyright line
  became `© 2016–<current year>` (built from the already-established
  "since 2016" founding fact, not a new one) so it never goes stale.
- Verified: `tsc --noEmit` clean, `next build` succeeds (still 46
  routes). Playwright QA at all six spec'd breakpoints (1440/1280/768/
  412/390/375px) across the homepage, `/search` and `/about`: zero
  horizontal overflow at every breakpoint, exactly one `<header>` and one
  `<footer>` on every one of the 13 required public pages, header/footer
  both visible at every breakpoint. Interaction tests: opening the mobile
  drawer sets `body { overflow: hidden }`; Escape collapses it back to
  `max-height: 0` and returns focus to the toggle button; a click outside
  the drawer also collapses it. Visual screenshot review at 1440px and
  375px confirmed the four footer columns, trust strip, "Coming Soon" app
  section, and bottom-bar policy links all render correctly and stack
  cleanly on mobile. The only console messages seen were `403` errors on
  the Pexels photo URLs — the pre-existing, documented sandbox-only image
  block (see "Photos" below), not a real issue.

## What exists (cumulative)

- Design tokens in `tailwind.config.ts` (colors, type, spacing, radius,
  shadow, breakpoints, z-index) — brand palette: navy #102C46, maroon
  #A51E3B, red #B51F40, gold #C99A45, cream #FFF9EF, etc. Breakpoints:
  sm 480 / md 768 / lg 1024 / xl 1200 / 2xl 1440.
- Component library: `src/components/ui/` (Button, Input/Select/Textarea,
  Badge/VerifiedBadge, Avatar, Accordion, StarRating, Toggle, Tabs,
  EmptyState/ErrorState/OfflineState/Skeleton, Container/Section),
  `src/components/profile/` (`ProfileCard` now with the `gated` variant),
  `src/components/membership/` (now including `CheckoutClient.tsx`),
  `src/components/search/`, `src/components/dashboard/`,
  `src/components/admin/`, `src/components/community/` (the
  Religion/Community select pieces), `src/components/layout/` (`Header`
  — reordered nav + mobile-drawer a11y, `Footer` — 4 columns + trust
  strip + honest app-promotion section). Both mount exactly once, in
  `src/app/(marketing)/layout.tsx`, and are never duplicated per page.
- 14 public marketing routes + Blog (index + 6 articles) + membership
  checkout + 9 Dashboard routes + 5 Staff Admin routes + 5 Super Admin
  routes — 46 routes total at last build. All 13 public pages the Header/
  Footer brief called out by name (`/`, `/home`, `/how-it-works`,
  `/search`, `/membership`, `/success-stories`, `/safety`, `/about`,
  `/contact`, `/faq`, `/privacy-policy`, `/terms`, `/refund-policy`)
  confirmed to render both components exactly once.
- The 10-Years Anniversary Hero — same z-index layering/colors/QA'd
  breakpoints as Phase 1; search widget asks Religion only (no
  Community/Caste — see Phase 2.3).
- Service layer pattern (`profileService`, `dashboardService`,
  `adminService`, `blogService`, `superAdminService`) — mock data in
  `src/data/`, designed so swapping to real APIs needs no component
  changes. `src/services/README.md` tracks implemented vs. still-planned
  modules, including how `PLATFORM_CONFIG` now backs live OTP-copy and
  checkout-gateway behavior, and how `ProfileCard`'s `gated` prop stands
  in for real session-based visibility.
- Religion → Community/Caste reference data (`src/data/communityData.ts`)
  used in search filters, Signup's Basic Details step, and the profile
  editor — deliberately not on the homepage hero widget.
- Anonymous visitors on public pages (homepage, `/search`) see blurred,
  no-name profile cards with a Login/Sign Up CTA; a logged-in member's own
  dashboard shows full profiles, unchanged.
- Global Header/Footer: exact-spec nav order (+ Blog), 4-column Footer,
  trust strip, honest "Coming Soon" app section (no fake Play Store URL),
  mobile drawer with scroll-lock/Escape/click-outside/focus handling.
- QA'd with Playwright: zero horizontal overflow at 1440/1280/768/412/
  390/375px across every route the Header/Footer brief named, and at
  1440/768/375px across every other route from earlier phases.

## Known issues fixed during build (don't reintroduce)

- `FinalCTA` outline button on dark background: never override only `text`
  color without also setting `bg-transparent` — same-specificity Tailwind
  classes don't reliably cascade in the order written (no tailwind-merge in
  this project — `cn()` is plain `clsx`).
- `ProfileCard`'s bottom action row needs at least ~300px of card width —
  always use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4` for profile
  grids, never `grid-cols-2` down to mobile width. Applies to both the
  full and `gated` variants.
- A Playwright QA run using `waitUntil: "networkidle"` timed out on
  `/dashboard/membership` even though the page is static/fast (confirmed
  via direct `curl` and a re-run with `waitUntil: "load"`) — a sandbox
  proxy/link-prefetch artifact, not a real bug. Don't trust a lone
  `networkidle` timeout without cross-checking `load` + a direct request.
- `FilterPanel` is rendered twice on `/search` (mobile `<details>` sheet +
  desktop `<aside>`), both present in the DOM simultaneously and toggled by
  CSS breakpoint — so any element id inside it (e.g. `#f-religion`) matches
  twice. A Playwright locator needs `.locator("visible=true")` (or an
  equivalent visibility filter) to hit the right one; this isn't new
  breakage, just easy to trip over in QA scripts.
- The `Bash`/build-check tool in this sandbox can go temporarily
  unavailable (a classifier-timeout error on every call) for an extended
  period (seen: several hours). Don't loop retrying it faster than every
  few minutes — schedule spaced-out retries (`send_later`) and give the
  user a status update instead of going silent or hammering the tool.
- When re-delivering a zip after route restructuring (e.g. the Phase 2
  `(marketing)` route group move), warn the user to extract into a
  **fresh folder**, not on top of an older extraction — leftover
  top-level route files (e.g. an old `src/app/search/page.tsx` alongside
  the new `src/app/(marketing)/search/page.tsx`) cause a Next.js "two
  parallel pages resolve to the same path" build error. This bit the user
  once already after the Phase 2 zip.
- `globals.css`'s `prefers-reduced-motion` block already targets the
  universal selector (`*, *::before, *::after`) for both
  `animation-duration` and `transition-duration` — any new
  `transition-*` utility (like the header drawer's `transition-[max-height]`)
  is covered automatically. No per-component reduced-motion handling is
  needed unless something bypasses Tailwind's `transition-*` utilities
  entirely (e.g. a raw CSS animation on a pseudo-element).

## Photos

Demo profile/couple/blog-cover photos are real, freely-licensed Pexels
images (credited in code comments), referenced by URL. The build sandbox
blocks outbound image fetches, so screenshots taken there show gradient
placeholders for photos — this resolves automatically with normal internet
access. Fonts are unaffected (self-hosted, see above).

## Suggested next phase

Real authentication/session handling + role-based access control (every
integration point is already code-commented — including gating
`/admin/super/*` to only actual super-admin sessions, making the OTP
channel copy reflect a live-fetched config instead of a shared constant,
making `ProfileCard`'s `gated` choice a real per-request auth check
instead of a fixed per-page one, and swapping the Header's public CTAs
for an account menu if a logged-in member is ever allowed to browse
marketing pages under the same shell), a real payment gateway integration
(SDK + webhook + real charge — the checkout UX/copy is already built and
matches the target flow), a real Play Store listing (so the Footer's
"Coming Soon" app section can become a real link), an Invoice History
screen, CMS, and the native Android app itself.


## B16 — Backend integration (done)

The frontend is no longer mock-backed. Every member screen (signup/login/password reset, dashboard, profile, photos, preferences, search, recommendations, interests, shortlist, matches, chat, notifications, membership/checkout, settings) and every admin screen (login, overview, users, profile approvals, reports, settings, revenue, audit log) reads and writes the real REST API through the same-origin `/bff/*` proxy, which keeps the session in httpOnly cookies. A typed API client (`src/lib/api/`) provides loading, empty, error, validation, conflict, rate-limit and network states everywhere. `src/data/` keeps only blog posts, FAQs and clearly labelled sample success stories. Verified at 375 / 768 / 1024 / 1440 px (184/184 page checks on the production build). See `B16_AUDIT.md`, `B16_RELEASE_READINESS.md`, `FINAL_HANDOVER.md`.
