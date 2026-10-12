# Provider test setup — Razorpay TEST mode + SMTP e-mail OTP

Goal: a working **local** integration using Razorpay **test/sandbox** keys and SMTP e-mail OTP. No live payment is ever possible with this setup (see "Safety rails"). Real credentials live **only** in your local, Git-ignored `.env`.

> Status of this repository: both integrations are real code (Razorpay REST API, nodemailer SMTP) and are covered by automated tests against **local mock servers**. They have **not** been run against Razorpay or a real mail server by the build environment (it has no outbound access to either). Run `npm run check:providers` on your machine to prove them — until that prints PASS, treat them as unverified.

## 1. Variables (names only — values go in `.env`, never in Git)

| Variable | Required | Notes |
|---|---|---|
| `PAYMENT_PROVIDER_MODE` | yes, local | Set to `real`. Unset means the built-in **mock** gateway is used outside production. |
| `RAZORPAY_KEY_ID` | yes | Dashboard **Test mode** key id, starts `rzp_test_`. |
| `RAZORPAY_KEY_SECRET` | yes | Matching secret. Server-only; never sent to the browser. |
| `RAZORPAY_WEBHOOK_SECRET` | only for webhooks | Must equal the secret you type in the Razorpay webhook form (step 2.4). |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | only if you save keys via Admin → Payments | 64 hex chars: `openssl rand -hex 32`. |
| `SMTP_HOST` | yes | e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | no (default 587) | 587 = STARTTLS, 465 = implicit TLS. |
| `SMTP_SECURE` | no | `true` only for port 465. |
| `SMTP_USER` / `SMTP_PASS` | usually | Mailbox login. For Gmail use an **App Password**, not your account password. |
| `EMAIL_FROM` | yes | e.g. `RishteyZindagi <you@example.com>`; must be a sender your SMTP account may use. |

Keys can alternatively be saved in **Admin → Platform Settings → Payment gateway** (stored AES-256-GCM encrypted). Admin-saved keys take precedence over `.env`.

## 2. Razorpay dashboard steps (test mode)

1. Log in at <https://dashboard.razorpay.com> and switch the toggle (top left) to **Test Mode**.
2. **Account & Settings → API Keys → Generate Test Key.** Copy *Key Id* (`rzp_test_…`) and *Key Secret* (shown once) into `.env`.
3. Set `PAYMENT_PROVIDER_MODE="real"` in `.env`, restart the app.
4. *(Optional – only to receive webhooks)* Dashboard → **Webhooks → Add New Webhook**. URL must be public HTTPS, e.g. a tunnel (`https://<tunnel>/api/v1/webhooks/razorpay`; `localhost` is not reachable by Razorpay). Choose a secret, put the same value in `RAZORPAY_WEBHOOK_SECRET`. Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. **Checkout works without webhooks** — the member's browser confirms through our server, which then re-reads the payment from Razorpay.
5. Test payments use Razorpay's test card/UPI details from <https://razorpay.com/docs/payments/payments/test-card-details/>. Only the success/failure test inputs listed there are valid in test mode.

## 3. SMTP steps (Gmail example — any SMTP works)

1. Enable 2-Step Verification, then create an **App Password** (Google Account → Security → App passwords).
2. `.env`: `SMTP_HOST="smtp.gmail.com"`, `SMTP_PORT="587"`, `SMTP_SECURE="false"`, `SMTP_USER="you@gmail.com"`, `SMTP_PASS="<app password>"`, `EMAIL_FROM="RishteyZindagi <you@gmail.com>"`.
3. Start the app, sign in as Super Admin, then:
   - **Platform Settings → OTP delivery provider → E-mail (SMTP)**.
   - **Platform Settings → OTP settings → turn OFF "Development mode"** and save. With it on, codes are kept in server memory and **never e-mailed** (a fresh database ships with it **off**, so codes go through SMTP; if you turned it on earlier, turn it off).

## 4. Verify the providers (run on your machine)

```bash
npm run check:providers                                  # env + Razorpay read-only call + SMTP login (no mail sent)
npm run check:providers -- --to you@example.com          # + send one test e-mail to a mailbox you control
npm run check:providers -- --create-test-order           # + create one unpaid ₹1.00 TEST order at Razorpay
```

It prints `PASS / FAIL / SKIP` per check, never a secret, and exits non-zero on any FAIL. It refuses to run with `NODE_ENV=production`. It also tells you if the OTP provider is not E-mail or Development mode is still on.

**Prerequisites:** `npm ci` done; `.env` in the project root with a working `DATABASE_URL`; the dev database migrated and seeded (`npm run db:migrate && npm run db:seed` — the script reads the OTP settings from the database); internet access for the Razorpay and SMTP checks. `NODE_ENV` must **not** be `production`: the key-mode guard refuses `rzp_test_` keys in production, so run the app with `npm run dev` (not `npm start`) for Razorpay test mode.

**What each outcome means**

| Output line | Meaning |
|---|---|
| `PASS Razorpay key mode — detected: test` + `PASS Razorpay API (read-only)` | Razorpay accepted your TEST key id/secret. |
| `PASS Razorpay TEST order (₹1.00, unpaid)` (with `--create-test-order`) | An unpaid ₹1 order was created in Razorpay Test Mode. No money moves. |
| `FAIL real Razorpay adapter in use` | `PAYMENT_PROVIDER_MODE=real` is missing, so checkout would still use the built-in mock gateway. |
| `FAIL key-mode guard` | A `rzp_live_` key is configured in a non-production environment. Replace it with a TEST key. |
| `FAIL Razorpay API` / `rejected the credentials` | Wrong key id/secret, or keys from the other (live/test) mode. |
| `PASS SMTP connection + login` | Host, port, `SMTP_SECURE` and credentials were accepted. Nothing was sent. |
| `PASS SMTP test e-mail` (with `--to`) | The server **accepted** the message. Confirm it really arrived in that mailbox (also check spam). |
| `FAIL SMTP … (EAUTH / 535)` | Wrong user or password. Gmail needs an App Password. |
| `FAIL SMTP … (ECONNREFUSED / ETIMEDOUT)` | Wrong host/port, or the network blocks outbound SMTP. |
| `FAIL OTP active provider` / `OTP dev mode` | Switch the provider to E-mail and turn Development mode off in Admin → Platform Settings. |
| `SKIP …` | An optional setting is not set (for example the webhook secret); not a failure. |

With no credentials at all the script correctly reports FAIL for the Razorpay and SMTP lines (exit code 1). A clean pass means "the providers accept this configuration"; a manual test payment and a real sign-up e-mail are still the final proof.

## 5. End-to-end by hand

1. Sign up with a mailbox you control → the 6-digit code arrives by e-mail → set password.
2. Log in from a second browser profile (new device) → another code is e-mailed (unless a Super Admin switched "new-device verification" off).
3. Membership → pick a plan → Checkout opens **Razorpay Checkout (test)** → pay with a Razorpay test method.
4. Success: the app calls our server, which verifies the signature **and** re-reads the payment from Razorpay; only then is the membership activated and an invoice issued. Closing the popup or a declined payment leaves the payment `PENDING` (it can be resumed) and activates nothing.

## 6. Safety rails (what the code enforces)

* **Key-mode guard** (`src/server/modules/payments/credentials.ts`): production accepts only `rzp_live_` keys; every other environment **refuses** `rzp_live_` keys — order creation, verification, refund, confirm, resume and gateway activation all fail closed with a clear admin message. A test key can therefore never charge real money, and a test key left in a production config can never run a checkout.
* Production never uses the mock gateway or OTP dev mode, regardless of database flags.
* Activation is **server-authoritative**: a success redirect, a client-supplied status or a validly signed browser callback alone never activates a membership; the amount and currency reported by Razorpay must equal the stored plan price.
* Duplicate callbacks / webhook retries are idempotent (one membership, one invoice).
* Gateway/SMTP errors surfaced to users and logs carry only a provider label and status class — never keys, SMTP passwords, OTP codes or response bodies.

## 7. Running the automated tests

```bash
npx tsc --noEmit
npm test                                   # full suite on the real local PostgreSQL test DB (≈15 min)
npx vitest run tests/pcp-provider-setup.test.ts tests/pcp-payments.test.ts tests/pcp-otp.test.ts
npm run build
npm run smoke:prod && npm run smoke:gateway   # real-HTTP smokes against a production build + mock providers
```

The provider tests use local mock Razorpay/SMTP servers (`tests/helpers/`). They prove our request construction, signature checks, idempotency and failure handling — **not** that Razorpay or your mail host accept your credentials; only `npm run check:providers` and a manual test payment can show that.

## 8. Not implemented / out of scope

* **Recurring billing / saved-card auto-debit:** not built. Auto-renew creates a new order but cannot charge a stored card.
* **Refunds** (`POST /admin/payments/:id/refunds`) and **webhooks** (`/api/v1/webhooks/razorpay`, HMAC-SHA256 signature, event-id idempotency) **are** implemented and tested against the mock only; neither has been exercised against real Razorpay.
* PhonePe, Fast2SMS, WhatsApp, FCM and S3 are outside this task.
