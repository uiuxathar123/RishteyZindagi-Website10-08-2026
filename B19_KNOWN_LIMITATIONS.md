# Known limitations — B19 (Super Admin controls, content, groups, live chat)

Read together with `B18_KNOWN_LIMITATIONS.md` and `PCP_KNOWN_LIMITATIONS.md`. **Items below replace those they name.** Severity scale unchanged (P0 data loss/security … P3 minor). **No open P0 or P1.**

## Superseded B18 "Not built" items

| Was listed as not built | Now |
|---|---|
| Change e-mail / mobile | **Built** (`API_REFERENCE.md` §22.6). Password + code sent to the *new* contact. |
| Admin MFA | **Built** as an e-mailed code (§22.2). No authenticator-app/TOTP and no recovery codes. |
| Real-time chat transport | **Built as Server-Sent Events**, with the old polling kept as a fallback (§22.7). **Not a WebSocket.** |
| Social "community groups" | **Built**, admin-curated (§22.8). |
| Maintenance-mode toggle, manual profile-approval toggle | **Built** (§22.1, §22.3). |
| E-mail digests | **Built** as an opt-in weekly job (§22.7). |
| Support-contact store, CMS success stories | **Built** (§22.4). |
| Recurring billing | **Groundwork only** (§22.9): lapsed-membership follow-up reminders. **Nothing is charged automatically.** |
| B18-P3-1 delegated `plans.manage` / `communities.manage` screens | **Fixed**: a staff role holding the permission sees the screen in its own menu. |
| B18-P3-5 security events: no export | **Export added** (CSV). Still no alerting. |

## P2 — material caveats

| # | Limitation | Why / workaround |
|---|---|---|
| B19-P2-1 | **Third-party providers are still unverified live.** Razorpay, SMTP, Fast2SMS, PhonePe, WhatsApp, FCM and S3 were exercised only against local protocol mocks. The new features that send e-mail (admin MFA codes, contact-change codes, weekly digest, follow-up reminders) were tested against a mock SMTP server. **Status: BLOCKED — needs your credentials and network.** | Run `npm run check:providers -- --to <your mailbox> --create-test-order` with Razorpay **test** keys and SMTP settings (see `PROVIDER_TEST_SETUP.md`), then do one test payment and receive one e-mailed code. Do not turn admin MFA on in production until an e-mailed code has reached a real inbox. |
| B19-P2-2 | **"Real-time" chat is SSE with a database poll behind it** (every 1.5 s per open stream, per app instance). It is correct across several instances because the database is the source of truth, but it is not a push bus: very large numbers of simultaneous open chats would need a real pub/sub (Redis, Postgres `LISTEN/NOTIFY`) or a WebSocket server. A reverse proxy that buffers responses breaks streaming; the client then falls back to its 10 s poll (45 s while a stream is open). Set `proxy_buffering off` for `/bff/chats/*/stream` (the app also sends `X-Accel-Buffering: no`). | Fine for the expected scale; revisit before heavy traffic. |
| B19-P2-3 | **No automatic charging.** The platform stores no card, token or mandate. The old "Automatic renewal failed" notice (from the PCP phase) still says *"couldn't automatically renew"* although no charge is ever attempted; the Membership page and admin Revenue page now say plainly that only reminders are sent. True auto-debit needs Razorpay Subscriptions / e-mandates (or PhonePe Autopay), customer consent screens and subscription webhooks. | Documented decision; reword the notice when you decide on a provider. |
| B19-P2-4 | **Manual profile approval is not retroactive.** Profiles that were already visible when you switch it on stay visible (backfilled as approved). Profiles already waiting in the queue stay waiting if you switch the setting off again — approve or reject them in the queue. | By design (avoids hiding existing members overnight). |
| B19-P2-5 | **Group posts are plain text and only moderated after the fact.** There is no profanity/phone-number filter; members can report, admins hide/remove. Do not enable groups for the public without staffing the *Community Groups* screen. | Groups only exist once an admin creates one, so nothing is exposed by default. |

## P3 — minor

| # | Limitation | Notes |
|---|---|---|
| B19-P3-1 | Admin MFA codes go to the admin's e-mail only; if the mailbox is lost, someone with server access runs `npm run admin:disable-mfa`. Failed codes count against the same login-attempt limits as passwords. | |
| B19-P3-2 | The weekly digest sends counts only (no names or message text) and uses plain text plus minimal HTML. Week = ISO week in Asia/Kolkata; a member with nothing to report gets no mail, and a week with nothing is not retried later that week. | |
| B19-P3-3 | The contact form stores the visitor's e-mail and message until an admin resolves it; there is no automatic deletion schedule yet. The IP is stored only as a keyed hash. | Add a retention rule to your privacy policy. |
| B19-P3-4 | Security events: export and trends exist, **alerting does not** (no e-mail/Slack when a suspicious pattern appears). | Not built. |
| B19-P3-5 | `GET /site-status` is polled by the site banner every 60 s per open tab (two small settings reads per call). | |
| B19-P3-6 | Group "member counts" and "open report" counts are computed on request (no cache). Fine for hundreds of groups, not millions of rows. | |
| B19-P3-7 | Changing e-mail does not re-send to the old address a "revert" link; the old address only receives a notice (when SMTP is configured). | |
| B19-P3-8 | Still outside the web app: the **Android app** (the home page keeps its honest "coming soon" notice). | |

## Frozen-phase files touched in B19 (disclosure)

| File | Why |
|---|---|
| `db/schema.ts`, `drizzle/0013`–`0018`, `db/seed.ts` | Additive columns/tables/permissions (`profiles.approve`, `support.manage`, `content.manage`, `groups.manage`). `profiles` gained approval columns with a backfill; `otp_purpose` gained `ADMIN_MFA`, `CONTACT_CHANGE`. |
| `error-handler.ts`, `errors.ts` | Central maintenance-mode check; `ServiceUnavailableError` accepts `details`. |
| `profiles.service.ts`, `profiles.dto.ts`, `search.repository.ts`, `recommendations.repository.ts`, `interactions.{service,repository}.ts` | Visibility now also requires `approvalStatus = APPROVED`. With manual approval off every profile is approved, so default behaviour is unchanged. |
| `otp.service.ts`, `otp.types.ts`, `providers/email.provider.ts` | `channel` override, `canDeliverEmailOtp()`, the two new purposes. |
| `admin.service.ts`, `admin.controller.ts`, `bff/config.ts` | Two-step admin login when MFA is on. |
| `member-settings.{service,controller}.ts` | `DIGEST` preference; contact-change routes. |
| `membership.ts` job (`membership-renewal-failed`) | After clearing the auto-renew flag it also starts a `renewal_cycles` row (idempotent). Notices and flag behaviour are unchanged. |
| `chat.repository.ts`, `chat.controller.ts` | Added read-only cursor queries and the stream handler. No existing chat rule changed. |
| `app/bff/[...path]/route.ts` | Relays `X-Accel-Buffering` (needed for event streams). |
| `lib/logger.ts` | Post-B19 audit: the redaction key list gained provider-credential names (`razorpay_signature`, `keySecret`, `webhookSecret`, `SMTP_PASS`, …). No log line carried them before; this is defence in depth. Covered by `tests/logger-redaction.test.ts`. |
| `tests/b18-permission-matrix.test.ts` | 19 new admin route rules added. Other changed tests are listed in `B19_FINAL_REPORT.md`. |
