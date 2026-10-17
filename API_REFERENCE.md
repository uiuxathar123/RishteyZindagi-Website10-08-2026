# RishteyZindagi API Reference

Generated as part of **B11 — Android Backend Integration / Mobile API
Readiness** (see `BACKEND.md` §55). This covers every endpoint a mobile
(Android) client consumes — in practice, nearly the entire `/api/v1/`
surface — pulled directly from the real zod validation schemas, DTOs, and
service logic in this codebase, not from memory or a spec document.
Admin endpoints (B9) are summarized more briefly, since an Android member
app never calls them.

## Conventions that apply to every endpoint

- **Base path**: every endpoint lives under `/api/v1/`. There are no
  routes outside this prefix.
- **Auth**: `Authorization: Bearer <sessionToken>`. No cookies are ever
  read or required — this API is stateless bearer-token auth end to end,
  which is exactly what a mobile HTTP client needs. A session token is a
  server-issued opaque value; there is no client-supplied "device
  identity" that functions as a credential.
- **Content type**: `Content-Type: application/json` for every JSON
  body. Photo upload is the one exception (`multipart/form-data`).
  Invoice download returns `application/pdf`.
- **Response envelope** — every single route builds its response through
  one of these, never a hand-rolled shape:
  ```json
  // success
  { "success": true, "data": { ... }, "message": "..." }
  // error
  { "success": false, "error": { "code": "...", "message": "...", "details": [...] } }
  ```
- **Error codes** (`error.code`, with the HTTP status it maps to):
  `VALIDATION_ERROR` (400), `AUTHENTICATION_ERROR` (401),
  `AUTHORIZATION_ERROR` (403), `NOT_FOUND` (404), `CONFLICT` (409),
  `RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR`
  (500, and its message is always generic — never a leaked stack trace
  or raw DB error).
- **Pagination** (where supported): query params `page` (default 1) and
  `pageSize` (default 20, max 50), response fields `page`, `pageSize`,
  `total`, `totalPages`. This is the shared convention across every list
  endpoint that has pagination at all — see the **known exception** callout
  in the Payments/Invoices/Membership-history sections below for the
  three endpoints that don't paginate.
- **Rate limiting**: in-memory, per-process, keyed by `ctx.subject.id`
  post-auth or by IP pre-auth. A trip returns `429 RATE_LIMITED`. Limits
  are noted per endpoint below where they're tighter than the module
  default.
- **IDs**: every path/body id is a UUID v4. An invalid UUID is a clean
  `400 VALIDATION_ERROR`, never an unhandled exception.
- **Ownership / IDOR pattern**: a resource id that doesn't exist and one
  that exists but isn't the caller's produce the *identical* error (either
  `404 NOT_FOUND` or `403 AUTHORIZATION_ERROR`, depending on the module —
  noted per section) — this is deliberate: it never reveals whether a
  given id exists at all to someone who doesn't own it.

---

## Table of contents

1. [Auth](#1-auth)
2. [Users](#2-users)
3. [Profiles](#3-profiles)
4. [Photos](#4-photos)
5. [Partner preferences](#5-partner-preferences)
6. [Search](#6-search)
7. [Recommendations](#7-recommendations)
8. [Interactions (Interest / Like / Shortlist / Match / Block)](#8-interactions)
9. [Chat](#9-chat)
10. [Notifications](#10-notifications)
11. [Device push tokens (B11 — new)](#11-device-push-tokens-b11--new)
12. [Membership plans & membership](#12-membership-plans--membership)
13. [Payments](#13-payments)
14. [Invoices](#14-invoices)
15. [Reports & warnings](#15-reports--warnings)
16. [Reference / lookup data](#16-reference--lookup-data)
17. [Health](#17-health)
18. [Admin (B9) — summary](#18-admin-b9--summary)
19. [B16 addendum — corrections and additions](#19-b16-addendum--corrections-and-additions-read-this-first)

---

## 1. Auth

None of these require auth (they ARE the auth flow), and are all rate-limited per-IP.

### `POST /auth/register`
Body: `{ name, email, mobileNumber, countryCode? }` (`mobileNumber`: 6-15
digits, no symbols; `countryCode` like `+91`, defaults if omitted).
Sends a SIGNUP OTP. → `{ identifier, channel, expiresInSeconds, resendAvailableAt }` (201).

### `POST /auth/verify-signup-otp`
Body: `{ identifier, code }`. → a one-time `ticket` used by `set-password`.

### `POST /auth/set-password`
Body: `{ identifier, ticket, password }` (password min 8 chars). Creates
the account and returns a real session directly: `{ user, sessionToken }` (201).
No separate login call is needed right after signup.

### `POST /auth/resend-otp`
Body: `{ identifier, purpose }` (`purpose`: `SIGNUP`|`LOGIN`|`FORGOT_PASSWORD`|`NEW_DEVICE`).

### `POST /auth/login`
Body: `{ email, password }`. Also reads the optional `X-Device-Id` header.
- Known device (one that already has a session for this user) → `{ user, sessionToken }`.
- Unrecognized device → step-up challenge: `{ deviceVerificationRequired: true, identifier, channel, expiresInSeconds, resendAvailableAt }` — no session token yet; follow with `/auth/verify-device`.
- Wrong credentials → `401`, identical message whether the email doesn't exist or the password is wrong (no enumeration; even response timing is now normalized — see BACKEND.md §54.4.7).

### `POST /auth/verify-device`
Body: `{ identifier, code }`. Completes the new-device OTP step-up → `{ user, sessionToken }`.

### `POST /auth/request-login-otp` / `POST /auth/verify-login-otp`
OTP-based login as an alternative to password login. Request body:
`{ email }` / verify body: `{ email, code }` → `{ user, sessionToken }`.

### `POST /auth/forgot-password` / `POST /auth/reset-password`
`{ email }` → sends an OTP (always `200`, identical message, whether or
not the account exists — no enumeration). `{ email, code, newPassword }`
→ resets the password and revokes existing sessions.

### `POST /auth/logout` — auth required
Revokes **only** the caller's own current session (`ctx.sessionId`) — a
mobile client's other logged-in devices are never affected.

### `POST /auth/logout-all` — auth required
Revokes every session for the calling member. → `{ sessionsRevoked }`.
Member accounts only (403 for an admin subject).

**Session behavior a mobile client should know**: a session token works
until its own `expiresAt` or until it's explicitly revoked (logout /
logout-all / password reset) — there is no server-side "app state" tied
to it, so an app being killed and reopened never invalidates it. Multiple
concurrent sessions per user are fully supported (no "one session per
user" constraint) — logging in from a second device does not revoke the
first.

---

## 2. Users

### `GET /users/me` — auth required
→ `{ user: PublicUser }` where `PublicUser` = `{ id, name, email,
mobileNumber, countryCode, status, emailVerified, mobileVerified,
country, city, createdAt }`. Never includes `passwordHash` or any
internal column.

---

## 3. Profiles

### `POST /profiles/me` — auth required
Body: `{ gender, dateOfBirth, aboutMe?, heightCm? }`. Creates the
caller's own profile (one per user). → `{ profile: OwnerProfileView }` (201).

### `GET /profiles/me` — auth required
→ `{ profile: OwnerProfileView }`.

### `PATCH /profiles/me` — auth required (30/min)
Body (all optional, `.strict()` — an unrecognized field is a clean 400):
`gender`, `dateOfBirth` (18-100 age range enforced), `maritalStatusId`,
`religionId`, `communityId`, `motherTongueId`/`motherTongueIds` (max 10),
`educationId`/`educationIds` (max 10), `professionId`/`professionIds`
(max 10), `incomeRange`, `incomeCurrency` (3-letter ISO 4217),
`incomeMinAmount`/`incomeMaxAmount` (min ≤ max enforced), `heightCm`,
`countryId`, `cityId`, `aboutMe` (max 2000 chars), `lifestyle` (`{diet,
smoking, drinking, disability}`), `familyDetails` (`{familyType,
familyValues, fatherOccupation, motherOccupation, siblings, notes}`). →
`{ profile: OwnerProfileView }`.

`OwnerProfileView` fields: `id, userId, displayName, gender,
dateOfBirth, age, maritalStatus, religion, community, motherTongue,
motherTongueIds, education, educationIds, profession, professionIds,
incomeRange, incomeCurrency, incomeMinAmount, incomeMaxAmount, heightCm,
country, city, aboutMe, lifestyle, familyDetails, verificationStatus,
verifiedAt, profileCompletionPercent, missingRequiredFields,
profileStatus, isReadyForVisibility, photos, createdAt, updatedAt`.

### `GET /profiles/me/completion` — auth required
→ `{ profileCompletionPercent, missingRequiredFields, profileStatus }`.

### `GET /profiles/{profileId}` — auth optional (works anonymously)
Four distinct response shapes depending on the viewer, always under the
same envelope:
- **Owner** → the full `OwnerProfileView` (as above).
- **Admin** → the full `OwnerProfileView`.
- **Authenticated non-owner** → `AuthenticatedPublicProfileView`: `{ id,
  displayName, age, gender, maritalStatus, religion, community,
  motherTongue, education, profession, incomeRange, heightCm, country,
  city, aboutMe, verificationStatus, photos }` (photos have gated URLs,
  never raw storage keys) — never email, mobile, or exact account data.
- **Anonymous visitor** → `AnonymousGatedProfileView`: `{ id,
  displayName: "Member Profile", age, country, city, education,
  profession, verificationStatus, photoBlurred }` — no photo URL at all.
- **404, identically**, whether the id doesn't exist, the profile isn't
  `READY_FOR_VISIBILITY`/the account isn't `ACTIVE`, OR the caller and
  the profile's owner have blocked each other in either direction (a B10
  IDOR fix — see BACKEND.md §54.4.1).

### `POST /admin/profiles/{profileId}/verify` — admin, `profiles.verify` permission
Body: `{ status: "UNVERIFIED"|"VERIFIED"|"REJECTED", notes? }`.

---

## 4. Photos

All under `/profiles/me/photos` except the file-serving route.

### `GET /profiles/me/photos` — auth required
→ `{ photos: OwnerPhotoView[] }` — each: `{ id, url, isPrimary,
sortOrder, uploadStatus, mimeType, fileSizeBytes, width, height,
moderation, createdAt }`. `url` is always
`/api/v1/profiles/photos/{photoId}/file` — a same-origin, backend-proxied
route, **never** a raw storage-provider URL or a `file://` path (confirmed
by B11's own audit, §55.4 §2.4 — unchanged from B3).

### `POST /profiles/me/photos` — auth required (20/min)
`multipart/form-data` with a `photo` file field. → `{ photo:
OwnerPhotoView }` (201).

### `PATCH /profiles/me/photos/{photoId}/primary` — auth required
Sets that photo as primary. → `{ photos: OwnerPhotoView[] }` (the whole
list, reordered).

### `PATCH /profiles/me/photos/reorder` — auth required
Body: `{ photoIds: string[] }` (full ordered list). → `{ photos: OwnerPhotoView[] }`.

### `DELETE /profiles/me/photos/{photoId}` — auth required
→ `{ ...result }` (deletion confirmation).

### `GET /profiles/photos/{photoId}/file` — auth required (no anonymous access)
Returns the raw image bytes (`Content-Type` set to the photo's real mime
type), not the JSON envelope — the one deliberate exception to "every
response goes through `ok()`/`fail()`" (documented in
`profiles.controller.ts`). Access: the owner always; an admin always; any
other authenticated caller only if the owning profile is
`READY_FOR_VISIBILITY` **and** `ACTIVE`.

---

## 5. Partner preferences

### `GET /profiles/me/partner-preferences` — auth required
→ `{ preferences }` (may be `null` if never set).

### `PATCH /profiles/me/partner-preferences` — auth required (30/min)
Body (all optional, `.strict()`): `ageMin`/`ageMax` (18-100, min≤max),
`heightMinCm`/`heightMaxCm` (90-250cm, min≤max), `genderPreference`
(`MALE`|`FEMALE`), `religionId`, `maritalStatusIds[]` (max 20 — no "any"
sentinel; omit/empty = no restriction), `communityIds[]`,
`motherTongueIds[]`, `educationIds[]`, `professionIds[]`,
`professionAny` (boolean — mutually exclusive with a non-empty
`professionIds`), `countryIds[]`, `cityIds[]`, `incomeMinAmount`/
`incomeMaxAmount` (min≤max), `incomeCurrency` (3-letter ISO), `notes`
(max 1000 chars). → `{ preferences }`.

---

## 6. Search

### `GET /search/profiles` — auth optional (works anonymously)
Rate limit: 60/min (keyed by user id if authenticated, else IP).
Every query key not in the recognized set below is rejected with a clean
400 ("unsupported query parameter") rather than silently ignored.

Query params: `gender`, `minAge`/`maxAge` (18-100, min≤max),
`religionIds`/`communityIds`/`motherTongueIds`/`educationIds`/
`professionIds`/`maritalStatusIds` (comma-separated uuid lists, max 30
each — every id is verified to actually exist, never trusted blindly),
`anyProfession` (`true`/`false`), `countryId`, `cityId`, `minHeightCm`/
`maxHeightCm` (90-250, min≤max), `minIncome`/`maxIncome` (min≤max,
`incomeCurrency` becomes *required* the moment either is set),
`incomeCurrency`, `page`, `pageSize` (max 50), `sortBy`
(`updatedAt`|`createdAt` — no "smart ranking" here, that's exclusively
`/profiles/me/recommendations`), `sortDir` (`asc`|`desc`).

→ `{ items, page, pageSize, total, totalPages }` where each item is
`{ audience: "authenticated", profile: AuthenticatedPublicProfileView }`
or `{ audience: "anonymous", profile: AnonymousGatedProfileView }`
depending on whether the caller is signed in (the shapes are exactly the
ones documented under §3's `GET /profiles/{profileId}`). A blocked
counterpart, in either direction, is always excluded.

---

## 7. Recommendations

### `GET /profiles/me/recommendations` — auth required (no anonymous access — 60/min)
Query: `page`, `pageSize` (max 50). Backend is the single source of truth
for matching/scoring logic — this is a read of already-computed
compatibility, not something a mobile client reshapes.

→
```json
{
  "status": "ok",
  "items": [ /* PRIMARY tier, paginated */ ],
  "secondaryItems": [ /* SECONDARY tier ("You May Also Like"), page 1 only, a bounded discovery shelf — NOT itself paginated */ ],
  "secondaryTotal": 0,
  "page": 1, "pageSize": 20, "total": 0, "totalPages": 1
}
```
Each item: `{ ...AuthenticatedPublicProfileView fields, compatibilityScore: number, compatibilityBreakdown: [{category, result, weight, contribution}], tier: "PRIMARY"|"SECONDARY" }`.

---

## 8. Interactions

All under `/interactions/`, all auth required. Every actor is derived
from the session, never a client-supplied id.

### `POST /interactions/interests` (30/min)
Body: `{ toUserId }`. **Requires the sender to have an ACTIVE
membership** (checked fresh on every request) — the one interest-related
business rule with a real precondition beyond auth. → `{ interest:
InterestView, matched: boolean }` (201) — `matched: true` when this send
completed a mutual interest and created a match immediately.
Idempotent/race-safe: two simultaneous sends for the same pair never
create two rows (unique-constraint + `onConflictDoNothing`, hardened in
B10).

### `GET /interactions/interests?direction=sent|received`
→ `{ interests: InterestView[] }`. `InterestView`: `{ id, fromUserId,
toUserId, status, createdAt, respondedAt, counterpart: {userId, name} }`.

### `PATCH /interactions/interests/{interestId}` (30/min)
Body: `{ status: "ACCEPTED"|"DECLINED"|"WITHDRAWN" }`. → `{ interest:
InterestView }`. Only the interest's recipient can ACCEPT/DECLINE; only
the sender can WITHDRAW.

### `POST /interactions/likes` (60/min) / `DELETE /interactions/likes/{toUserId}` (60/min) / `GET /interactions/likes?direction=sent|received`
Body for POST: `{ toUserId }`. Idempotent (unique pair). → `{ like:
LikeView }` (201) / `{ toUserId }` / `{ likes: LikeView[] }`.

### `POST /interactions/shortlist` (60/min) / `DELETE /interactions/shortlist/{targetUserId}` (60/min) / `GET /interactions/shortlist`
Body for POST: `{ targetUserId }`. Idempotent. → `{ shortlist:
ShortlistView }` (201) / `{ targetUserId }` / `{ shortlist:
ShortlistView[] }`.

### `GET /interactions/matches`
→ `{ matches: MatchView[] }` — `{ id, matchedAt, counterpart }`.

### `POST /interactions/blocks` (20/min)
Body: `{ targetUserId, reason? (max 500 chars) }`. Idempotent
(unique pair). → `{ block: BlockView }` (201). Blocking excludes the
pair bidirectionally from search, recommendations, direct profile view,
and chat.

### `DELETE /interactions/blocks/{targetUserId}` (20/min) — idempotent
### `GET /interactions/blocks`
→ `{ blocks: BlockView[] }`.

---

## 9. Chat

All auth required, gated by "mutual match + active membership" (checked
fresh, never cached).

### `POST /chats` (20/min)
Body: `{ counterpartUserId }`. Get-or-create — idempotent (unique
`matchId`, reopening an existing chat returns the same row). Requires an
existing match with that user. → `{ chat: ChatView }` (200 if it already
existed, 201 if newly created) — `{ id, matchId, createdAt,
lastMessageAt, counterpart }`.

### `GET /chats`
→ `{ chats: ChatSummaryView[] }` (`ChatView` + `unreadCount`).

### `GET /chats/unread-count`
→ `{ count }`.

### `GET /chats/{chatId}/messages?page=&pageSize=`
Paginated (standard `page`/`pageSize`/`total`/`totalPages` shape). →
`{ items: MessageView[], page, pageSize, total, totalPages }` —
`MessageView`: `{ id, chatId, senderUserId, body, sentAt, readAt, mine }`
(`mine` is pre-computed server-side from the viewer's session, so a
client never has to re-derive "sent by me" itself).

### `POST /chats/{chatId}/messages` (60/min)
Body: `{ body }` (1 to `MAX_MESSAGE_LENGTH` chars, trimmed, non-empty).
**Not idempotent by design** — resending identical text creates a second
real message; a client retrying after a timeout can produce a visible
duplicate, which is the correct behavior, not a bug (see BACKEND.md
§55.5). Blocked pairs and an expired membership on the sender's side
both cleanly reject with an error, never a silent drop. → `{ message:
MessageView }` (201).

### `POST /chats/{chatId}/read` (60/min)
Marks the chat read up to now for the caller. → `{ chatId, updated }`.

---

## 10. Notifications

All auth required, all scoped to the caller only (`notification.userId === ctx.subject.id`).

### `GET /notifications?page=&pageSize=`
→ `{ items: NotificationView[], page, pageSize, total, totalPages }`.
`NotificationView`: `{ id, channel, title, body, isRead, readAt,
deliveryStatus, createdAt }` (`channel`: `EMAIL`|`SMS`|`WHATSAPP`|
`PUSH`|`IN_APP`; `deliveryStatus`: `PENDING`|`SENT`|`DELIVERED`|`FAILED`
— `failureReason` is deliberately never exposed to the client, an
internal delivery detail only).

### `GET /notifications/unread-count`
→ `{ count }`.

### `PATCH /notifications/{notificationId}/read` (60/min) — idempotent
→ `{ notification: NotificationView }`.

### `PATCH /notifications/read-all` (20/min) — idempotent
→ `{ updated: number }` (count actually flipped).

**Delivery honesty**: only `IN_APP` is ever actually dispatched by this
backend today (B7's own deliberate scope choice, unchanged). `EMAIL`/
`WHATSAPP`/`PUSH` notification rows exist in the schema and can reach
`SENT`/`FAILED` if a real provider is configured, but no event in this
codebase currently triggers a real EMAIL/WHATSAPP/PUSH send — this is
documented, not a gap to work around.

---

## 11. Device push tokens (B11 — new)

**New in this phase.** Push-notification device-token *registration/
addressing* — not push delivery. No real vendor (FCM/APNs) is wired in;
`send()` on the real push provider still always throws (unconfigured).
What this section documents is genuinely real: registering a token,
listing your devices, and revoking one, all backed by a real table
(`device_push_tokens`) that `notify()`'s PUSH channel genuinely reads
from when addressing a user (see BACKEND.md §55.2).

### `POST /devices/push-tokens` — auth required (30/min)
Body (`.strict()`): `{ token: string (8-4096 chars), platform:
"ANDROID"|"IOS"|"WEB" }`. Upsert-by-token: registering the same token
twice updates one row (refreshes `lastSeenAt`, un-revokes if it had been
revoked) rather than creating a duplicate. Re-registering an existing
token under a *different* now-current user reassigns ownership to that
user (a real device can change hands/accounts). A client-supplied
`userId` in the body is rejected outright (400) — ownership always comes
from the session, never the body.
→ `{ device: { id, token, platform, registeredAt, lastSeenAt } }` (201).

### `GET /devices/push-tokens` — auth required
→ `{ devices: [{ id, platform, registeredAt, lastSeenAt }] }` — the
caller's own currently-live (non-revoked) devices only. The raw `token`
value is never echoed back in the list (only the register response
returns it, once, at creation time — the same "handed back once" posture
a session token has elsewhere in this API).

### `DELETE /devices/push-tokens/{tokenOrId}` — auth required (30/min)
`{tokenOrId}` accepts either the row's own `id` (from the register
response) or the raw token string itself — URL-encode the token if it
contains characters not safe in a path segment. Idempotent — revoking an
already-revoked token is a clean no-op. Revoking a token you don't own
(by id or by string) is denied with `403 AUTHORIZATION_ERROR`, identical
whether the id/token doesn't exist at all — verified IDOR-safe by
`[push-token-idor-revoke]`/`[push-token-idor-revoke-by-token-string]`.
→ `{ revoked: true }`.

**Recommended mobile flow**: call `POST /devices/push-tokens` once at
app start and again whenever the OS hands the app a refreshed token
(FCM token rotation); call `DELETE` with the token on logout if the app
wants to stop receiving pushes on that device for the signed-out
account.

---

## 12. Membership plans & membership

### `GET /membership-plans?currency=INR|USD` — no auth
→ `{ plans }` — the public catalog.

### `GET /membership-plans/me` — auth required
Resolves the caller's own region (from their profile's country) to the
matching currency's plans. → `{ plans, currency }` (defaults to INR if
the caller has no profile/country yet).

### `GET /memberships/me` — auth required
→ `{ membership: MembershipView | null, ...extra status fields }`.
`MembershipView`: `{ id, planId, status, startedAt, expiresAt,
autoRenew, createdAt }` (`status`: `PENDING`|`ACTIVE`|`EXPIRED`|
`CANCELLED`).

### `GET /memberships/me/history` — auth required
→ `{ memberships: MembershipView[] }`. **Known exception to the
pagination convention** (see BACKEND.md §55.6): no `page`/`pageSize`
params exist, no pagination envelope — a bare, complete array. Left this
way deliberately since a member's own history is inherently small
(bounded per-person, unlike a system-wide list); an additive pagination
retrofit (accept optional `page`/`pageSize`, add the envelope fields
alongside the existing array when supplied) is the recommended future
fix if this list ever needs it, documented so a later phase doesn't have
to rediscover the reasoning.

### `PATCH /memberships/me/{membershipId}/cancel-auto-renew` (20/min) / `PATCH /memberships/me/{membershipId}/enable-auto-renew` (20/min)
→ `{ membership: MembershipView }`. Ownership-checked
(`membership.userId === ctx.subject.id`), same IDOR posture as every
other module.

### `POST /memberships/me/renew` (10/min)
Body: `{ planCode?, devSimulateOutcome? }`. Creates a renewal checkout →
same shape as `POST /memberships/checkout` below (see §13).

### `POST /memberships/me/auto-renew-attempt` (10/min) / `POST /memberships/me/renewal-reminder-check` (20/min)
Background-style member-triggered endpoints for the auto-renew flow /
sending a renewal reminder if one is due. → service-specific result
objects (`{ sent: boolean }` for the reminder check).

---

## 13. Payments

### `POST /memberships/checkout` — auth required (10/min)
Body (`.strict()`): `{ planCode, autoRenew?, devSimulateOutcome?
("SUCCESS"|"FAILED"|"PENDING" — dev/test-only mock-gateway control, has
no effect against a real gateway) }`. Creates a `PENDING` payment +
membership; never activates immediately. **Duplicate-checkout
protection**: a second checkout for the same plan within a short TTL
window is rejected with `409 CONFLICT`, not silently deduped — read the
409 and poll/verify the existing pending payment instead of retrying
blindly. → `{ paymentId, membershipId, transactionRef, providerOrderId,
amountInPaise, currency, gatewayName, status: "PENDING" }`.

### `POST /payments/{paymentId}/verify` — auth required (30/min)
Body: `{}`. Confirms the payment against the (mock, in this sandbox)
gateway and, only on genuine `SUCCESS`, activates the membership and
issues an invoice. **Idempotent** (compare-and-swap since B10): a second
call on an already-resolved payment returns `{ status:
"ALREADY_RESOLVED" }` instead of re-activating anything — safe to retry
after a network timeout or app restart. → `{ payment: PaymentView,
status: "SUCCESS"|"FAILED"|"PENDING"|"ALREADY_RESOLVED" }`. Never trusts
a client-claimed success — the gateway (mock, server-side) decides, and
its confirmed amount/currency is cross-checked against what was actually
charged at checkout (rejecting a mismatch — B10 §54.4.2).

### `GET /payments/{paymentId}` — auth required
→ `{ payment: PaymentView }`. **This is the mobile "app was killed
mid-checkout" recovery path**: after a checkout with no verify call
completed (app closed, network dropped), reopen and poll this endpoint
— it reports the current status without re-verifying, so a client can
tell PENDING from SUCCESS from FAILED before deciding whether to resume
with `verify`.

### `GET /payments/me` — auth required
→ `{ payments: PaymentView[] }`. **Known pagination exception** — same
reasoning and same recommended future fix as `/memberships/me/history`
above (§12).

`PaymentView`: `{ id, membershipId, gatewayId, amountInPaise, currency,
status, gatewayReference, verifiedAt, verificationMethod, createdAt,
updatedAt }` — never includes raw gateway credentials (those live
encrypted on a separate table, never serialized into any API response).

---

## 14. Invoices

### `GET /invoices/me` — auth required
→ `{ invoices: InvoiceSummaryView[] }` — `{ id, invoiceNumber,
amountInPaise, status: "ISSUED"|"PAID"|"VOID", issuedAt, cancelledAt }`.
**Known pagination exception** — same as §12/§13 above.

### `GET /invoices/{invoiceId}` — auth required
→ `{ invoice: InvoiceDetailView }` (summary fields + `paymentId,
cancellationReason, snapshot`). Ownership-checked.

### `GET /invoices/{invoiceId}/download` — auth required
Returns the raw PDF bytes (`Content-Type: application/pdf`,
`Content-Disposition: attachment`), not the JSON envelope — the same
kind of deliberate binary-response exception as the photo-file route
(§4).

---

## 15. Reports & warnings

### `GET /reports/categories` — auth required (any signed-in member)
→ `{ categories }`.

### `POST /reports` — auth required (20/min)
Body (`.strict()`): `{ reportedUserId, categoryId, description? (max
2000 chars) }`. Self-report is blocked. Not deduped at the DB level
(each submission is a new row), but harmless in practice: the
auto-suspend threshold counts *unique reporters*, never raw report rows,
so a retried submission from the same reporter never double-counts (see
BACKEND.md §55.5). → `{ report }` (201).

### `GET /warnings/me` — auth required
→ `{ warnings }` — the caller's own warning history.

### `PATCH /warnings/{warningId}/acknowledge` — auth required (30/min)
→ `{ warning }`. Ownership-checked (`warning.userId === ctx.subject.id`).

---

## 16. Reference / lookup data

### `GET /reference/profile-options?countryId=&religionId=` — no auth
Rate-limited by IP (120/min). → seeded controlled lookup lists
(religions, mother tongues, educations, professions, countries, marital
statuses; cities for the given `countryId`, communities for the given
`religionId` when supplied). Used to populate dropdowns client-side
without hardcoding ids.

Optional `countryIso` (`?countryIso=IN`): a two-letter ISO 3166-1
alpha-2 code, case-insensitive, used instead of `countryId` when the
caller does not know the country's id. The response is the same as for
that country's `countryId`: the lists above plus its `cities`. It can be
combined with `religionId`. Sending both `countryIso` and `countryId`,
or a code that is not two letters, → `400 VALIDATION_ERROR`. A
well-formed code that no country has → `200` with `cities: []`, as an
unknown `countryId` gives. Send countryIso once; repeating it returns 400
VALIDATION_ERROR.

---

## 17. Health

### `GET /health` — no auth
→ `{ status: "ok", ... }` with a live DB connectivity check. Useful for
a mobile app's own connectivity/maintenance-banner logic, not a
capability endpoint.

---

## 18. Admin (B9) — summary

Android does not call these; summarized briefly per the master brief's
own instruction. All under `/admin/*`, session-authenticated against a
**separate** admin identity system (`admin_users`/`admin_roles`, not
`users`), permission-gated per row below (STAFF_ADMIN's default grant is
`admin.ping`/`users.view`/`profiles.verify`/`reports.resolve`; everything
else is SUPER_ADMIN-only until explicitly granted — see BACKEND.md §54.2
for the full, exhaustively-audited matrix).

| Area | Routes | Permission |
|---|---|---|
| Auth | `POST /admin/login`, `GET /admin/ping` | public / any admin |
| Dashboard | `GET /admin/dashboard` | `users.view` |
| Users | `GET /admin/users`, `GET /admin/users/{id}`, `POST /admin/users/{id}/lift-suspension` | `users.view` / `users.suspend` |
| Warnings | `GET+POST /admin/users/{id}/warnings`, `GET /admin/warning-categories` | `warnings.issue` (SUPER_ADMIN) |
| Reports | `GET /admin/reports`, `PATCH /admin/reports/{id}`, `GET+POST /admin/report-categories`, `PATCH /admin/report-categories/{id}` | `reports.resolve` / `reports.categories.manage` (SUPER_ADMIN) |
| Matching weights | `GET+PATCH /admin/matching/weights` | `platform.settings.manage` |
| OTP config | `GET+PATCH /admin/otp/config` | `platform.settings.manage` (SUPER_ADMIN) |
| Payment gateways | `GET /admin/payment-gateways`, `PATCH/{id}`, `.../activate`, `.../deactivate`, `.../test-connection` | `platform.settings.manage` |
| Payments | `GET /admin/payments`, `POST /admin/payments/{id}/manual-activate` | `payments.review` (SUPER_ADMIN) |
| Invoices | `GET /admin/invoices`, `GET/{id}`, `POST /{id}/cancel`, `POST /{id}/regenerate` | `payments.review` |
| Memberships | `GET /admin/memberships` | `payments.review` |
| Profile verification | `POST /admin/profiles/{id}/verify` | `profiles.verify` |
| Audit logs | `GET /admin/audit-logs` | `audit.view` (SUPER_ADMIN) |

Every admin list endpoint uses the identical `page`/`pageSize`/`total`/
`totalPages` pagination shape as the member-facing lists in this
document (§6/§7/§9/§10).

---

*Generated for B11. Pulled from the real zod schemas, DTOs, and service
code in this repository as of the B11 freeze — see `BACKEND.md` §55 for
the audit this document was produced alongside.*

---

## 19. B16 addendum — corrections and additions (read this first)

This document was generated in B11. During the B16 integration every endpoint
was exercised over real HTTP; the following differences from the text above
were found. **The route files under `src/app/api/v1/**/route.ts` are the
authority for HTTP methods and shapes.**

### 19.1 HTTP-method corrections

| Documented above | Actual |
|---|---|
| `PATCH /notifications/{notificationId}/read` | **`POST`** |
| `PATCH /notifications/read-all` | **`POST`** |
| `PATCH /memberships/me/{membershipId}/cancel-auto-renew` / `enable-auto-renew` | **`POST`** |
| `PATCH /warnings/{warningId}/acknowledge` | **`POST`** |
| `POST /admin/profiles/{profileId}/verify` (§3 and §18) | **`PATCH`**, body `{ "status": "VERIFIED" \| "REJECTED" … }` |

Unchanged and verified: `PATCH /profiles/me`, `PATCH /profiles/me/partner-preferences`, `PATCH /profiles/me/photos/{id}/primary`, `PATCH /profiles/me/photos/reorder` (`{ "photoIds": [uuid…] }`), `PATCH /interactions/interests/{id}` (`{ "status": "ACCEPTED"\|"DECLINED"\|"WITHDRAWN" }`), `PATCH /admin/otp/config`, `PATCH /admin/matching/weights`, `PATCH /admin/reports/{id}`, `PATCH /admin/report-categories/{id}`, `PATCH /admin/payment-gateways/{id}`; `POST …/activate|deactivate|test-connection` for gateways.

### 19.2 Request/response shapes confirmed

* Auth bodies: `request-login-otp` `{ email }`, `verify-login-otp` `{ email, code }`, `forgot-password` `{ email }`, `reset-password` `{ email, code, newPassword }`, `verify-device` / `verify-signup-otp` / `set-password` use `identifier`.
* `GET /users/me` → `{ user: {…} }` (not a bare user). `GET|PATCH|POST /profiles/me` → `{ profile }`. The owner view has **no `age`** (age is derived on the public/search views from `dateOfBirth`).
* `GET /profiles/{id}` → `{ audience: "owner"\|"admin"\|"authenticated"\|"anonymous", profile }`. Search items and recommendation items have the same `{ audience, profile }` wrapper.
* Photo upload: `multipart/form-data` with the file in the field **`photo`** (≤ 5 MB, ≥ 200×200 px).
* `POST /memberships/checkout` → `{ paymentId, membershipId, transactionRef, providerOrderId, amountInPaise, currency, gatewayName, status }`; then `POST /payments/{paymentId}/verify`. `devSimulateOutcome` is accepted only outside production.
* `PATCH /admin/matching/weights` takes the **ten weights flat** (`age, height, religion, community, motherTongue, education, profession, maritalStatus, location, income`), whole numbers summing to **exactly 100**; `GET` returns `{ weights: {…}, … }`. Request validation runs **before** the permission check, so an invalid body from a Staff Admin answers 400, a valid one 403.
* `GET /interactions/likes` and `/interactions/interests` default to `direction=received`.
* Chat/interest/like/shortlist/block responses are wrapped: `{ interests }`, `{ likes }`, `{ shortlist }`, `{ matches }`, `{ blocks }`.

### 19.3 New / changed in B16 (additive only)

| Change | Detail |
|---|---|
| **`GET /admin/me`** (new, 96th route) | Any admin session. Returns `{ admin: { id, name, email, role }, permissions: [sorted permission keys] }`. Used by the admin panel to show only what the role can do (the API still enforces every permission). `GET /admin/ping` is unchanged. |
| `userId` on the **authenticated** public profile view | Lets the UI act on a profile (like/interest/shortlist/block take a *user* id). The anonymous view never carries it. |
| `counterpart.profileId` (`string \| null`) on interest / like / shortlist / block / match / chat rows | The id `GET /profiles/{profileId}` needs. `counterpart.userId` is unchanged. |

### 19.4 Browser access: the `/bff` session proxy

The website does not call `/api/v1` from the browser. It calls the same-origin proxy `/bff/<path>` (= `/api/v1/<path>`), `/bff/admin/<path>` (= `/api/v1/admin/<path>`, admin cookie only) or `/bff/as-admin/<path>` (non-admin endpoints with the admin session). The proxy: moves `sessionToken` out of JSON responses into an **httpOnly** cookie (`rz_session` SameSite=Lax for members, `rz_admin_session` SameSite=Strict for admins), attaches `Authorization: Bearer` server-side, rejects cross-origin state-changing requests (403), clears the cookie on logout or a 401, forwards the real client IP/user-agent for rate limiting and device logic, and streams binary files (photos, invoice PDFs). Native/mobile clients keep using `/api/v1` with a Bearer token exactly as documented above.

Development-only helpers: `GET /bff/dev/status` answers `{ available: false }` and `GET /bff/dev/otp-code` answers 404 unless `NODE_ENV` is not `production` **and** `otp_configs.dev_mode` is on.

---

## 20. Production Completion Phase (PCP) addendum — 24 new routes (120 in total)

All envelopes are `{ success, data, message }` / `{ success:false, error:{ code, message } }`. Authority for methods and bodies is the route file and its zod schema. Errors worth knowing: a wrong *current/confirmation password* is **403** (not 401, because the browser proxy ends the session on any 401); a forged payment signature is **400**; rate-limited answers carry `Retry-After`.

### 20.1 Member / public

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /users/me/delete-account` | member | Start deletion. Requires the current password; account becomes `DELETED_PENDING`, all sessions and push tokens revoked, recovery window `ACCOUNT_RECOVERY_WINDOW_DAYS` (default 30). Wrong password → 403. |
| `POST /auth/recover-account/request` | public, rate-limited | Body `{ email, password }` (strict). Sends an `ACCOUNT_RECOVERY` OTP to the account's own contact. The answer is identical for unknown / wrong-password / expired accounts (no enumeration). |
| `POST /auth/recover-account/confirm` | public, rate-limited | Body `{ email, code }` (strict). Restores the account inside the window; refused afterwards. Admins can see pending deletions but cannot restore on the owner's behalf. |
| `POST /payments/{paymentId}/razorpay/confirm` | member (owner) | Body `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }`. Verifies HMAC with the server-held secret, then re-verifies with Razorpay server-to-server; only then activates. Bad signature → 400. |
| `POST /payments/{paymentId}/razorpay/resume` | member (owner) | Re-opens an unpaid Razorpay order (same order id; public values only). 409 if no longer pending / expired / not Razorpay; 503 if not configured. |
| `POST /webhooks/razorpay` | gateway (HMAC `X-Razorpay-Signature` over the raw body) | Idempotent by `X-Razorpay-Event-Id`. 503 until a webhook secret exists; invalid signature → 401. |
| `POST /webhooks/phonepe` | gateway (`Authorization: SHA256(username:password)`) | Idempotent by body hash; state is re-read from PhonePe before acting. |
| `POST\|GET /internal/jobs/{job}` | `Authorization: Bearer CRON_SECRET` | Runs one scheduled job. Anything else answers 404 (the endpoint does not reveal itself). Jobs: `membership-expiry`, `membership-reminders`, `membership-renewal-failed`, `payment-reconcile`, `account-deletion-finalize`, `housekeeping`. |

`POST /memberships/checkout` now returns `gatewayCheckout` (public values only: Razorpay `{provider,keyId,orderId,amount,currency}` or PhonePe `{provider,redirectUrl}`) for real gateways. If the gateway cannot create an order the pending rows are closed and the original error (e.g. 503) is returned.

### 20.2 Admin (Bearer admin session; permission shown)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET\|PATCH /admin/payments/config` | `platform.settings.manage` | View status of Razorpay/PhonePe (never secret values: `configured`, `credentialSource` none/environment/admin, `mode`, names of stored fields, webhook URL) / choose the **one** active gateway. |
| `PUT /admin/payments/config/{gateway}/credentials` | `platform.settings.manage` | Save credentials (encrypted AES-256-GCM with `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`). `gateway` = `razorpay` \| `phonepe`. Audited without values. |
| `POST /admin/payments/config/{gateway}/test-connection` | `platform.settings.manage` | Real authenticated call to the vendor; reports reachable/rejected. |
| `GET\|POST /admin/payments/{paymentId}/refunds` | `payments.review` | List / create a refund (amount capped at the unrefunded balance; server decides, not the client). |
| `GET\|PATCH /admin/otp/provider` | `platform.settings.manage` | Choose exactly one of `EMAIL` \| `FAST2SMS_SMS`; atomic; codes already issued stay valid. |
| `GET /admin/account-deletions` | `users.view` | Deletion queue (e-mail masked). |
| `POST /admin/users/{id}/suspend`, `/ban`, `/unban`; `GET …/moderation` (the earlier `lift-suspension` route is unchanged) | `users.suspend` / `users.ban` / `users.view` | Suspend, ban, unban, lift. **Reason required.** Audited; sessions revoked. Automatic suspension at five distinct reporters is unchanged. |
| `GET\|POST /admin/staff`, `PATCH /admin/staff/{id}`, `POST /admin/staff/{id}/reset-password` | `staff.manage` | List / create (one-time temporary password), change role/status, reset password. `SUPER_ADMIN` accounts cannot be created, edited, demoted or disabled through the API; you cannot change your own role or disable yourself; a non-Super actor may only manage roles whose permissions are a subset of their own. |
| `GET\|POST /admin/roles`, `PUT /admin/roles/{id}/permissions` | `staff.manage` | List/create roles (Super Admin only; `SUPER_ADMIN` itself is protected); replace a role's permission set (Super Admin only). |
| `POST /admin/me/password` | any admin | Change own password (`currentPassword`, `newPassword` ≥ 10 chars). Clears the temporary-password gate. Wrong current password → 403. |

---

## 21. B18 — Pending features & admin integration (addendum)

Envelope, auth and error conventions are unchanged. Admin routes are listed with the permission they enforce on every request (the full machine-checked table is `B18_PERMISSION_MATRIX.md`, mirrored by `tests/b18-permission-matrix.test.ts`). **Super** = role-name check (`SUPER_ADMIN` only; a Staff Admin can never be granted these).

### 21.1 Search (changed / new)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /search/profiles` | public (limited view) / member | New filter `profileId` (exact member-facing ID, `RZ` + 8 digits, case-insensitive; any other shape → 400). `sortBy` = `updatedAt` \| `createdAt`, `sortDir` = `asc` \| `desc`, `page`, `pageSize` (1…`maxPageSize`; default from Platform Settings). **Advanced filters** — `profileId`, height range, income range, `educationIds`, `professionIds`/`anyProfession` — need a plan with the `advancedSearch` entitlement *when enforcement is on* (Platform Settings): anonymous or member without the entitlement → 403 `AUTHORIZATION_ERROR` with `details: [{path:"entitlement",message:"advancedSearch"}, …one row per filter used]`. Everything else (gender, age range, religion, community, mother tongue, marital status, country, city) stays free for everyone. A profile whose owner chose **Hide my profile** is never returned. Cards include `photosRestricted` and `lastActive` (see 21.4). |
| `GET /search/access` | soft-auth (never 401) | `{ audience: "visitor"\|"member", advancedSearch: boolean, advancedFilters: string[] }` — a UI hint so public/marketing pages can show or lock the advanced filters without triggering the member-401 redirect. `/search/profiles` enforces independently. |
| `GET /memberships/me` | member | Now also returns `entitlements: { advancedSearch, chat, visibilityBoost }`. |

### 21.2 Super Admin controls

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /admin/otp/policy` | **Super** | Per-workflow requirement (`OTP_REQUIRED` / `OTP_NOT_REQUIRED`) for the *configurable* workflows `NEW_DEVICE_LOGIN` and `SIGNUP_VERIFICATION`, plus the list of workflows that are never configurable (password reset, account recovery, OTP-only login, admin login, payments). Also returns the single active provider (`EMAIL` or `FAST2SMS_SMS`) — policy and provider are independent. |
| `PATCH /admin/otp/policy` | **Super** | Body `{ workflow, requirement, reason? }` (strict). Unknown workflow, or a non-configurable one, → 400. Audited with actor, time, previous and new value. Any read problem falls back to `OTP_REQUIRED`. |
| `GET\|PATCH /admin/platform-settings` | `platform.settings.manage` | Body `{ search?: { defaultPageSize (5–50), maxPageSize (10–50), enforceAdvancedSearchEntitlement }, signup?: { open, closedMessage } }` (strict; at least one block). Closing sign-up makes `POST /auth/register` answer 503 with `closedMessage` (or a default message); existing members and log-in are unaffected. |
| `GET\|POST /admin/membership-plans`, `PATCH /admin/membership-plans/{planId}` | `plans.manage` | List, create (`code` `[A-Z0-9_]{3,40}`, `name`, `currency` INR\|USD, `priceInSmallestUnit` ≥ 100, `durationDays` 1–730, `advancedSearch`, `isActive`), edit. `PATCH` body (strict, ≥ 1 field): `name`, `priceInSmallestUnit`, `advancedSearch`, `isActive`. Duration and currency are immutable once created (create a new plan instead). A price change applies to *new* purchases only — every payment and invoice stores the amount it was charged. Deactivating a plan stops new purchases but never touches members who already hold it. Duplicate `code` → 409. The 180-day visibility boost is derived from the duration, not edited. |
| `GET\|POST /admin/communities`, `PATCH /admin/communities/{communityId}` | `communities.manage` | Pick-list management (`name` 2–80, `religionId`). Duplicate (case-insensitive, per religion) → 409. "Retire" (`isActive:false`) hides a community from sign-up pick-lists and search filters and refuses it on new profile edits; existing profiles keep the value. |
| `GET /admin/security-events` | `audit.view` | Unified feed of failed/successful logins (identifier masked), and security-relevant admin/member changes. Filters `type` (ALL, LOGIN_FAILED, LOGIN_SUCCEEDED, CHANGES), `actor`, `q`, `dateFrom`, `dateTo`, `page`, `pageSize` ≤ 50. |
| `GET\|POST /admin/payments/reconcile` | `payments.review` | `GET` lists the last 5 `payment-reconcile` job runs; `POST` triggers the same job a scheduler runs (the job runner's advisory lock turns a concurrent click into a no-op; rate-limited 6/min; audited as `payments.reconcile_requested` with the actor). It re-reads stale pending payments/refunds from the gateway and never closes one the gateway could not be asked about. |
| `GET /admin/users` (extended) | `users.view` | New filters `verificationStatus`, `membership` (ACTIVE\|NONE), `openReports=true`, `sort` = `newest`\|`oldest`\|`name`\|`lastActive`; `q` also matches the member-facing profile ID. Rows include the profile ID and `lastActiveAt`. |

### 21.3 Member self-service settings

| Method & path | Auth | Purpose |
|---|---|---|
| `GET\|PATCH /users/me/privacy` | member | `{ profileVisibility: VISIBLE\|HIDDEN, photoVisibility: MEMBERS\|ACCEPTED_ONLY, showLastActive: boolean }` (strict; ≥ 1 field; 404 until the member has a profile). Audited with before/after. Does **not** bump `profiles.updated_at`. |
| `GET\|PATCH /users/me/notification-preferences` | member | `{ EMAIL?, PUSH?, WHATSAPP? }` booleans (strict). Opt-outs apply to non-essential EMAIL/PUSH/WHATSAPP messages only. IN_APP notifications, payment confirmations, invoices and security/warning notices are never suppressed. |
| `GET /users/me/sessions` | member | Live (unrevoked, unexpired) sessions of the caller only: `id`, `browserInfo`, `ipAddress`, `createdAt`, `lastUsedAt`, `expiresAt`, `current`, truncated `deviceId`. Token hashes are never returned. |
| `DELETE /users/me/sessions/{sessionId}` | member | Sign out one other device immediately. Own current session → 409 (use logout). Another member's id is indistinguishable from a missing one (404). |
| `DELETE /users/me/sessions` | member | Sign out every device except the current one (also revokes their push tokens). |

### 21.4 Privacy enforcement (all member-facing read paths)

| Setting | Search | Recommendations | `GET /profiles/{id}` | `GET /profiles/photos/{id}/file` | `POST /interactions/interests` |
|---|---|---|---|---|---|
| `profileVisibility = HIDDEN` | excluded | excluded | 404 for everyone except the owner, admins and **accepted** connections | same 404 | 404 unless already an accepted connection |
| `photoVisibility = ACCEPTED_ONLY` | `photos: []`, `photosRestricted: true` | same | same | 404 unless owner / admin / accepted connection | – |
| `showLastActive = false` | `lastActive: null` | same | same | – | – |

`lastActive` is a coarse label (`Active today` / `this week` / `this month` / `a while ago`), never a timestamp. `users.last_active_at` is now written (throttled to once per 5 minutes) on authenticated member requests — before B18 the column existed but was never populated.

## 22. B19 — Super Admin controls, content, groups, live chat (addendum)

All responses use the usual `{success,data,message}` envelope. Admin routes need an admin session; **SUPER** = Super Admin role only. Member routes need a member session. Every admin change below is audited (actor, time, previous/new value where relevant).

### 22.1 Site controls and public status

| Method & path | Auth | Purpose |
|---|---|---|
| `GET\|PATCH /admin/site-controls` | SUPER (+`platform.settings.manage`) | Body (strict, ≥ 1 block): `maintenance: { enabled?, message? }`, `approval: { manualApproval? }`, `digest: { enabled? }`, `reason?`. Turning maintenance **on** needs a `reason` ≥ 5 chars. `GET` returns the three blocks with `updatedAt`, and `digest.mailerConfigured`. |
| `GET /site-status` | public | `{ maintenance, message, signupOpen }` — nothing else. Used by the site banner. |
| `GET\|PATCH /admin/security-settings` | SUPER (+`platform.settings.manage`) | `{ mfaRequired }`. Switching **on** is refused with 409 unless e-mailed codes can be delivered right now (OTP enabled and SMTP configured). `GET` also returns `emailDeliveryReady`. |

Maintenance mode answers every member/visitor request with **503** and `details.maintenance = true`. Exempt: `/admin/*`, `/webhooks/*`, `/internal/*`, `/health`, `/site-status`. A missing or unreadable setting means *not* in maintenance.

### 22.2 Admin MFA (e-mailed code)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /admin/login` (changed) | public | When MFA is on and the password is right, returns `{ mfaRequired: true, sentTo (masked), channel: "EMAIL", expiresInSeconds, resendAvailableAt }` and **no session**. |
| `POST /admin/login/verify-mfa` | public | `{ email, code }` → the normal admin login result (session cookie set by the BFF). Failed codes are counted like failed passwords. |

Break-glass if e-mail ever stops working: `npm run admin:disable-mfa` (server access required; audited as SYSTEM).

### 22.3 Manual profile approval (Visibility Queue)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /admin/profile-approvals?status=PENDING\|APPROVED\|REJECTED&page&pageSize` | `profiles.approve` | Queue with display name, profile id, completion, submitted time. |
| `POST /admin/profile-approvals/{profileId}` | `profiles.approve` | `{ decision: "APPROVE"\|"REJECT", reason? }` — reject needs a reason ≥ 5 chars. A repeat decision → 409. |

With the switch on, a profile that becomes complete for the first time waits as `PENDING` and is invisible to other members (search, recommendations, direct view, photos, new interests) until approved. Already-visible profiles are grandfathered. A rejected profile that is edited and complete again goes back to `PENDING`. The owner view (`GET /profiles/me`) gains `approvalStatus` and `approvalReason`.

### 22.4 Support contact, contact form, success stories

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /support-contact`, `GET /success-stories` | public | Admin-entered contact details; published stories only. |
| `POST /contact` | public | `{ name, email, topic, subject, message, website }` — `website` is a honeypot (non-empty → silently accepted and dropped). Limits: 5/hour per IP, 3/hour per e-mail. The IP is stored only as a keyed hash. |
| `GET\|PATCH /admin/support-contact` | `support.manage` | `{ email, phone, hours }`. |
| `GET /admin/contact-messages`, `PATCH /admin/contact-messages/{messageId}` | `support.manage` | Inbox (`status` NEW/READ/RESOLVED filter) and `{ status?, adminNote? }`. |
| `GET\|POST /admin/success-stories`, `PATCH\|DELETE /admin/success-stories/{storyId}` | `content.manage` | Publishing needs `consentConfirmed: true` (else 409). No story is ever seeded. |

### 22.5 Dashboard and security events

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /admin/dashboard/trends?days=7..90` | `users.view` | Daily sign-ups, payments, revenue (per currency) in the Asia/Kolkata calendar, zero-filled. |
| `GET /admin/security-events/export` | `audit.view` | `text/csv`, same filters as the list, max 5 000 rows, formula-injection safe, audited as `security_events.exported`. |

### 22.6 Member: change e-mail / mobile

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /users/me/contact-change/request` | member | `{ type: "EMAIL"\|"MOBILE", newValue, countryCode?, password }`. Needs the current password; refuses a taken/identical/malformed value; sends a code to the **new** contact. 5/hour. |
| `POST /users/me/contact-change/confirm` | member | `{ type, newValue, code }`. Updates the account, marks it verified, signs out **other** sessions, writes a masked audit entry, notifies in-app (and by e-mail to the old address when SMTP is configured). 10/hour. |

### 22.7 Live chat (SSE) and weekly digest

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /chats/{chatId}/stream` | member, participant | `text/event-stream`. Events: `ready`, `message` (same shape as the paged API; `id` = message id), `reconnect` (server closes after ~55 s; the browser reconnects with `Last-Event-ID`). `: keep-alive` comments every 15 s. 4 open streams per member; non-participant → 403; 30 connects/min. **This is Server-Sent Events, not a WebSocket.** The web client keeps its 10-second poll as a fallback. |
| `PATCH /users/me/notification-preferences` (changed) | member | Adds `DIGEST` (boolean, **off by default**). |

The `member-digest` job (`npm run job -- member-digest`, suggested weekly) e-mails opted-in members one summary per ISO week: pending interests, matches in the last 7 days, unread messages. Counts and a dashboard link only. Skipped when the admin master switch is off, SMTP is not configured, the member turned the E-mail channel off, or there is nothing to report.

### 22.8 Community groups

Member routes (`ACTIVE` account; joining and posting also need a complete, approved profile):

| Method & path | Purpose |
|---|---|
| `GET /groups` | Active groups with `memberCount`, `joined`, `removed`. |
| `GET /groups/{groupId}` | One group. |
| `POST /groups/{groupId}/join`, `POST /groups/{groupId}/leave` | Idempotent. A member an admin removed gets 403 on join. |
| `GET\|POST /groups/{groupId}/posts` | Members only (else 403). `POST { body }` 1–1000 chars (10/min, 100/day). Authors appear as "First L."; your own as "You"; posts by members you blocked (or who blocked you) are hidden from you. |
| `DELETE /group-posts/{postId}` | Author only; anything else → 404. |
| `POST /group-posts/{postId}/report` | `{ reason }` 3–300 chars; once per reporter; own post → 400; non-member → 404. |

Admin routes (`groups.manage`, delegable):

| Method & path | Purpose |
|---|---|
| `GET\|POST /admin/groups`, `PATCH /admin/groups/{groupId}` | List with member/post/open-report counts; create; rename/describe/deactivate. Duplicate name → 409. |
| `GET /admin/groups/{groupId}/posts?filter=all\|reported\|hidden` | Posts with author name and report count. |
| `PATCH /admin/group-posts/{postId}` | `{ hidden, reason? }` — hiding needs a reason ≥ 5 chars; the author is notified; reversible. |
| `GET /admin/groups/{groupId}/members`, `PATCH /admin/groups/{groupId}/members/{userId}` | `{ removed, reason? }` — removal needs a reason; blocks rejoining until restored. |

### 22.9 Renewal follow-up (reminders only)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /admin/renewals` | `payments.review` | Counts of follow-up cycles by state (`LAPSED`, `FOLLOW_UP_SENT`, `RENEWED`, `CLOSED`) and the 20 most recent, plus a note that nothing is charged automatically. |

Job `membership-dunning` (hourly suggested): `LAPSED` → one reminder after 3 days → `CLOSED` after 10 days, or `RENEWED` when the member buys a newer active membership. Cycles are created by `membership-renewal-failed` for lapsed memberships that had the auto-renew preference on. **No payment is ever created.**
