# OTP delivery setup — Email (SMTP) and Fast2SMS SMS

**Labels:** VERIFIED = exercised by an executed automated test against an in-process mock server. NOT VERIFIED / REQUIRES EXTERNAL CREDENTIALS = never run against the real vendor; do the checklist in section 5 before launch.

---

## 1. Model

- Exactly **one** OTP delivery provider is active: **Email** (your SMTP relay) or **Fast2SMS SMS**. Super Admin → **Platform Settings → OTP delivery provider** (`GET|PATCH /api/v1/admin/otp/provider`, body `{ "activeProvider": "EMAIL" | "FAST2SMS_SMS" }`, permission `platform.settings.manage`). The switch is one atomic update of a single-row table — there is no moment with two active providers or none.
- **Codes already issued stay valid after a switch.** The switch only changes which channel *new* codes go through. Verification looks up the stored (hashed) code by identifier + purpose and does not depend on the provider, so a member who asked for a code by email can still use it a minute after you switch to SMS. VERIFIED (`tests/pcp-otp.test.ts`).
- **The platform generates, hashes, expires and attempt-limits every code itself.** Fast2SMS is used for *delivery only* (the code is passed in the `otp` field). Fast2SMS's own `/verify` endpoint is deliberately not used because it is keyed by mobile number alone (it would break purpose separation and make in-flight codes depend on the active provider).
- The existing controls keep working for both providers: code length, expiry, wrong-attempt limit, resend cooldown, resend-per-window limit and per-purpose separation (SIGNUP, LOGIN, FORGOT_PASSWORD, NEW_DEVICE, ACCOUNT_RECOVERY). They are edited in **OTP settings** under the provider card.
- **In production an unconfigured provider cannot be activated** (HTTP 409 naming the missing variable *names*), so an admin cannot lock everyone out by picking a provider with no credentials. Outside production the switch is allowed so development mode keeps working.
- Credentials live **only in server environment variables**. No API returns them and the admin screen shows only "complete / incomplete" and the *names* of missing variables. Neither the code nor the destination is written to logs; vendor error bodies are never copied into logs or responses (status code only).
- WhatsApp OTP is not a selectable provider and is rejected in production.

## 2. Email (SMTP)

Variables: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` for implicit TLS on 465), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (a sender your relay accepts, e.g. `RishteyZindagi <no-reply@yourdomain>`). **Required for the provider to count as configured: `SMTP_HOST` and `EMAIL_FROM`.**

Any SMTP relay works (Amazon SES SMTP, Brevo, Mailgun, Postmark, Google Workspace relay…). Use a dedicated sending domain with SPF, DKIM and DMARC records, otherwise OTP mail will land in spam — that is outside this codebase and cannot be verified here. Connection/greeting/socket timeouts are enforced so a dead relay cannot hang a request; if SMTP is unconfigured the send fails with a generic 503 — it never pretends to have delivered.

## 3. Fast2SMS

1. Create a Fast2SMS account, complete their DLT/sender requirements for India, and obtain an **API key** (Dev API) and an approved **OTP template id**.
2. Set `FAST2SMS_API_KEY` and `FAST2SMS_OTP_ID` (**both required**). Leave `FAST2SMS_API_BASE` unset in production.
3. The adapter calls `POST https://www.fast2sms.com/dev/otp/send` with header `Authorization: <key>` and JSON `{ mobile, otp_id, otp, otp_length, otp_expiry }`, and treats the send as successful only on HTTP 200 **and** `return: true`. Anything else → a generic 503 to the member ("could not be sent right now") and a status-only log line.
4. Only **10-digit Indian mobile numbers** are supported by this adapter; a member whose stored number is not valid gets a clear validation error instead of a silent drop.
5. Switch the active provider in the admin panel once `check:prod-env` shows the Fast2SMS variables present.

> The request/response shape above follows Fast2SMS's published OTP API as understood when this was written. It is **NOT VERIFIED** against the live service: DLT approval, template matching, route restrictions and balance are account-specific. Run the checklist below.

## 4. Operating notes

- Rate limits (shared Postgres store, so they hold across instances): every unauthenticated credential/OTP endpoint (`/auth/login`, `register`, `request-login-otp`, `verify-*`, `resend-otp`, `forgot-password`, `reset-password`, `recover-account/*`) is limited per client IP on top of the per-OTP attempt and resend limits.
- If the active provider's vendor is down, sign-up/login-by-OTP/password-reset fail with 503 for new codes; members with a still-valid code are unaffected. Switch the provider from the admin panel as a fail-over — the switch is audited (`otp_config.provider_switched`).
- Development mode (`devMode`) stores codes in memory for developers and is **impossible to enable when `NODE_ENV=production`**.

## 5. Go-live checklist (REQUIRES EXTERNAL CREDENTIALS)

1. `npm run check:prod-env` → no errors; the OTP provider card shows the chosen provider as **complete**.
2. Request a sign-up code to your own email / Indian mobile → it arrives, verify it, sign-up completes.
3. Request a code, **before using it** switch the provider in the admin panel, then use the code → it is accepted (in-flight code stays valid).
4. Request a new code → it arrives through the new channel.
5. Try wrong codes up to the configured attempt limit (default 5) → the code is locked; request many codes quickly → rate-limited.
6. Check the application log for the above requests: no code, no phone number, no email body appears.
7. Record the evidence; it is what turns these items from NOT VERIFIED to VERIFIED.
