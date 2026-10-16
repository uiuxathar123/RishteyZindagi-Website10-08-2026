# Mobile App Roadmap (Android first)

**Current state:** there is no mobile app in the repository: no Android, iOS, React Native, Flutter, Capacitor or PWA manifest/service-worker files. What exists is a backend designed to be called by a mobile client. This document records how ready that backend is (verified from code) and what an app would still need.

## 1. What is already in place (verified)

| Capability | Evidence |
|---|---|
| Stateless bearer-token auth on every `/api/v1` route; no cookies needed | `src/server/middleware/authenticate.ts`; BFF is browser-only |
| End-to-end flow over bearer + JSON only: register → OTP → password → login → profile → search → membership → payment → invoice → interest → match → chat | `tests/mobile-integration.test.ts` `[mobile-full-flow]` |
| Several concurrent sessions per user; logging out one device keeps the others | `[mobile-multi-session]`, `[mobile-logout-one-session-only]` |
| Works with only `Authorization` and `Content-Type` headers | `[mobile-minimal-headers]` |
| App killed after checkout: poll `GET /payments/:id`, then verify | `[mobile-app-killed-poll-then-verify]` |
| One pagination shape (`page`, `pageSize`, `total`, `totalPages`) for search, recommendations, messages, notifications | `[pagination-shared-shape]`; documented exceptions for `/payments/me`, `/invoices/me`, `/memberships/me/history` |
| New-device verification keyed on an app-supplied `X-Device-Id` (`[A-Za-z0-9._:-]{1,128}`) | `auth.controller.ts` `sanitizeDeviceId` |
| Push token registry (ANDROID / IOS / WEB) and FCM HTTP v1 sender | `src/server/modules/devices/`, `notifications/providers/push.provider.ts` *(outlined)* |
| Razorpay order data returned for a client SDK (`gatewayCheckout`: key id, order id, amount, currency) | `payments.service.ts` `checkout` |
| Consistent error envelope and codes | `src/server/lib/errors.ts`, `response.ts` |
| CORS is irrelevant for native apps; it only applies to browsers | `src/middleware.ts` |

## 2. Gaps before an Android app can ship

| ID | Gap | Why it matters | Proposed approach |
|---|---|---|---|
| M-1 | **No refresh tokens.** One opaque token lasts `SESSION_TTL_HOURS` (default 30 days), then the user must log in again. | Long-lived tokens on a phone; abrupt logout at expiry. | Short access token + rotating refresh token, or sliding expiry on use. |
| M-2 | **No API contract file** (OpenAPI). `API_REFERENCE.md` is prose, and the route files are the authority. | Hand-written client models drift. | Generate OpenAPI from the zod schemas, or write it once and test against it. |
| M-3 | **No app-version gating.** The API cannot tell an outdated app to update. | Breaking changes would strand old installs. | Send `X-App-Version`; add a `/site-status`-style minimum-version field. |
| M-4 | **Photos come only as authenticated full-size bytes** through `/api/v1/profiles/photos/:id/file`, with `no-store`. | Slow, expensive on mobile data; no offline cache. | Thumbnails plus short-lived signed URLs (see `PERFORMANCE_ROADMAP.md` P-2). |
| M-5 | **Live chat uses SSE with server polling.** | Mobile networks drop long connections; battery cost. | Push notification on new message plus fetch-on-open; later a real-time channel. |
| M-6 | **Payments in the app.** Razorpay data is returned, but no Android Razorpay SDK flow has been tried. PhonePe returns only a hosted `redirectUrl` (`payments/providers/phonepe.provider.ts:156`), so an app would open it in a browser or WebView. Google Play billing rules for digital subscriptions must be checked. | Store policy can block the app. | Legal/business check of Play policy first, then integrate the Razorpay Android SDK against test keys. |
| M-7 | **SMS OTP only reaches Indian numbers** (Fast2SMS). | NRI users on phones expect SMS. | International SMS provider, or e-mail OTP as the default for non-+91 numbers (D-7). |
| M-8 | **No device attestation** (Play Integrity) or certificate pinning. | Scripted abuse of sign-up and OTP endpoints. | Add Play Integrity on sign-up and login; keep the existing rate limits. |
| M-9 | **Unpaginated lists** for likes, interests, shortlist, blocks, matches, chats. | Large payloads on phones. | Paginate (`PERFORMANCE_ROADMAP.md` P-8). |
| M-10 | **Deep links** for payment return, e-mail links and notifications are not defined. | Payment return page and e-mails point at the website. | Define Android App Links for the site domain. |
| M-11 | **Account deletion inside the app.** The API exists (`/users/me/delete-account`); Play requires an in-app path and a web path. | Store requirement. | Expose the existing flow in the app; the web flow already exists. |
| M-12 | **No crash or analytics SDK decision.** | Needed for support after launch. | Owner to choose (privacy policy update needed). |

## 3. Suggested phases

1. **Contract and auth (backend):** OpenAPI file (M-2), refresh tokens (M-1), app version header (M-3). Only after approval.
2. **Media and lists (backend):** thumbnails and signed URLs (M-4), pagination (M-9).
3. **App MVP (Android):** sign-up/login with OTP, profile and photos, search, recommendations, interests, matches, notifications via FCM, chat with push (M-5), membership purchase (M-6) after the Play policy check.
4. **Hardening:** Play Integrity (M-8), deep links (M-10), in-app deletion (M-11), crash reporting (M-12).

## 4. Acceptance criteria per phase (proposed)

| Phase | Done when |
|---|---|
| 1. Contract and auth | An OpenAPI file covers every member route used by the app and a test fails when a route drifts from it; a refresh flow keeps a user signed in past the access-token lifetime and revoking a session revokes its refresh token; an app below the minimum version gets a clear "please update" response. |
| 2. Media and lists | A search page of 20 cards downloads thumbnails only (measured bytes recorded in `PERFORMANCE_REPORT.md`); every list the app uses returns the shared page shape. |
| 3. App MVP | The `[mobile-full-flow]` sequence works by hand in the real app against a staging backend with test vendor keys; a new chat message produces a push notification; the Play policy decision for payments is written down before the payment screen ships. |
| 4. Hardening | Sign-up and login reject requests without a valid Play Integrity token (with a documented fallback); payment-return and e-mail links open the app; in-app account deletion reaches `DELETED_PENDING`. |

## 5. Still to investigate

* Read `notifications/providers/push.provider.ts` and `devices/*` in full (currently OUTLINED) before relying on push.
* Confirm how the PhonePe redirect and the payment-return page behave inside a WebView.
* Decide where the app gets `X-Device-Id` from (a generated install id is the usual choice) and what happens on reinstall (it will look like a new device and trigger the OTP step).

Technology choice (Kotlin native, Flutter, React Native) is the owner's decision and is not assumed here.
