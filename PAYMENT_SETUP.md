# Payment gateway setup — Razorpay and PhonePe

**Status labels used in this document**

| Label | Meaning |
|---|---|
| VERIFIED | Exercised by an executed automated test in this repository (against an in-process mock of the gateway, never the real vendor). |
| NOT VERIFIED | Never run against the real vendor. |
| REQUIRES EXTERNAL CREDENTIALS | Cannot be proven until you supply real merchant credentials and run it. |

Everything below that touches the real gateway is **REQUIRES EXTERNAL CREDENTIALS / NOT VERIFIED live**. The adapters were written against the vendors' published API shapes and tested against mocks that reproduce those shapes; nobody has yet taken a real payment through this code. Do the "first live payment" checklist (section 6) before announcing the site.

---

## 1. How payments work

- Exactly **one** gateway is active at a time: Razorpay or PhonePe. The Super Admin switches it in **Admin → Platform Settings → Payment gateway** (`PATCH /api/v1/admin/payments/config`). Activating one deactivates the other in a single transaction. Orders already created at the previous gateway keep working: each payment remembers the gateway that created it, and webhooks / verification for it go to that gateway.
- The server — never the browser — decides the price. `POST /api/v1/memberships/checkout` takes a plan code, reads the plan's price from the database, creates the order at the gateway for that amount, and returns only public values (Razorpay key id / order id / amount, or a PhonePe redirect URL). A client-supplied amount is not accepted.
- A membership is activated only after the server has proof of capture:
  - Razorpay: the browser returns `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` to `POST /payments/:id/razorpay/confirm`; the server checks `HMAC_SHA256(order_id|payment_id, key_secret)` in constant time, **and** then asks Razorpay for the payment and checks status, order id and amount.
  - PhonePe: the member is redirected to PhonePe's hosted page and comes back to `/membership/payment-return?paymentId=…`; the page calls `POST /payments/:id/verify`, which asks PhonePe for the order status. The query string is never trusted.
  - Both: signed webhooks (section 4) and the `payment-reconcile` job (section 5) settle payments whose browser never came back.
- All of the above is idempotent: confirming/verifying/webhooking the same payment twice activates one membership and issues one invoice.
- **Reopening an unpaid Razorpay order.** If the member closes the popup, the checkout page shows *Continue to payment*, which calls `POST /payments/:id/razorpay/resume` and hands back the **same** order (key id, order id, stored amount, currency — public values only; owner-only, PENDING-only, refused after `PAYMENT_PENDING_EXPIRY_MINUTES`). It creates nothing and grants nothing; success still requires the signed confirm, a webhook or the reconcile job. A PhonePe payment cannot be reopened this way (its hosted-page URL is not stored); see `PCP_KNOWN_LIMITATIONS.md` P2-9.
- A fresh database lists **Razorpay as the active gateway with no credentials**. Checkout then answers *"not configured"* (it never falls back to a mock outside development) until credentials are saved in Platform Settings or the environment.
- Refunds: **Admin → Revenue → Payments → Refunds** (`payments.review`). The refundable balance is computed under a row lock (captured amount minus PENDING and PROCESSED refunds); a refund is shown as *Processed* only after the gateway says so; `PENDING` refunds are synced by webhook and by the reconcile job.

## 2. Credentials: where they live

Two supported places, admin-saved values win over environment:

1. **Admin panel** (Platform Settings → Payment gateway → *Credentials*). Values are encrypted with AES-256-GCM using `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` and stored in `payment_gateways.config`. They are write-only: no API ever returns a stored secret — the screen only shows which fields are stored.
2. **Environment variables** (preferred if you use a secrets manager): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION`, `PHONEPE_ENV` (`sandbox` | `production`), `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD`.

Generate the encryption key once and keep it safe (losing it makes admin-saved credentials undecryptable; you would re-enter them):

```
openssl rand -hex 32     # -> PAYMENT_CREDENTIALS_ENCRYPTION_KEY
```

`PAYMENT_PROVIDER_MODE` only matters **outside** production: unset/`dev` uses the built-in development mock gateway, `real` makes a dev/staging server talk to the real (sandbox) gateway APIs. When `NODE_ENV=production` the value is ignored and the real Razorpay/PhonePe adapters are always used — the mock gateway can never take a production order (VERIFIED: `tests/pcp-payments-prod-guard.test.ts`).

Mode: for Razorpay the key id prefix (`rzp_test_` / `rzp_live_`) decides test vs live and the admin screen displays it. For PhonePe, the admin "Mode" (Test → sandbox, Live → production) wins over `PHONEPE_ENV`; if neither is set it fails safe to **sandbox**.

## 3. Razorpay

1. Razorpay Dashboard → Settings → API Keys → generate a key pair (start with **Test mode**). Enter *Key ID* and *Key secret* in the admin screen (or env).
2. Dashboard → Settings → Webhooks → add webhook:
   - URL: `https://<your-domain>/api/v1/webhooks/razorpay` (the admin screen shows the exact URL for your `APP_URL`).
   - Secret: choose a random string (≥ 8 characters), enter the same value as *Webhook secret* here.
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed` (any `payment.*`, `order.paid` and `refund.*` event is accepted; others are acknowledged and ignored).
3. Click **Test connection** in the admin screen: it performs one authenticated, read-only call to Razorpay and reports the result. No money moves.
4. Activate Razorpay.

Webhook authentication: `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook secret), compared in constant time. Missing/invalid signature → 401 and nothing is processed. No webhook secret configured → 503 (so Razorpay retries after you configure it). Idempotency: `UNIQUE(provider, event_id)` on `payment_webhook_events` using `X-Razorpay-Event-Id`; a replay returns 200 `DUPLICATE` and changes nothing.

## 4. PhonePe

1. PhonePe Business dashboard → Developer settings → obtain *Client ID*, *Client secret*, *Client version* (start with the sandbox/UAT set). Enter them in the admin screen (Mode: Test) or env.
2. Configure the webhook (callback) in the PhonePe dashboard:
   - URL: `https://<your-domain>/api/v1/webhooks/phonepe`.
   - Username/password: choose values; enter the same as *Webhook username / password* here.
3. Test connection (it authenticates against PhonePe's OAuth endpoint; no order is created), then activate.

Webhook authentication: PhonePe sends `Authorization: SHA256(username:password)`. This implementation accepts the lowercase hex digest with or without a `SHA256 ` prefix, in constant time. **The PhonePe documentation does not define an event id**, so idempotency uses the SHA-256 of the raw body: an exact replay is deduplicated; a *different* body for the same order is processed again but is itself idempotent at the payment level (an already-resolved payment is never re-activated).

Handled events: `checkout.order.completed|failed` (reconciles the payment by asking PhonePe for the order status — the webhook body is a trigger, not the authority) and `pg.refund.*` (syncs the refund). Anything else is acknowledged and ignored.

> No PhonePe behaviour beyond what its published API documents has been invented here. Where the documentation is silent (webhook event id, exact header encoding) the code says so in comments and chooses the tolerant, still-authenticated behaviour described above. Confirm against your PhonePe account manager before go-live.

## 5. Reconciliation and expiry (`payment-reconcile` job)

Schedule `payment-reconcile` every 5–10 minutes (see DEPLOYMENT_PRODUCTION.md §6). For PENDING payments older than 10 minutes it asks the gateway for the truth and completes the payment if it was paid. An unpaid order is **closed as FAILED only after** `PAYMENT_PENDING_EXPIRY_MINUTES` (default 60) **and** a positive "still unpaid" answer from the gateway (or when no gateway reference exists). Gateway errors never close a payment — they are counted and retried. Once an hour it re-checks recently closed payments; if one was captured late, an audit entry `payment.late_capture_detected` is written so staff can activate or refund it — money never silently disappears.

## 6. First live payment checklist (REQUIRES EXTERNAL CREDENTIALS)

1. `npm run check:prod-env` → no errors.
2. Test-mode credentials saved; **Test connection** is green; webhook URL registered at the gateway.
3. Buy the cheapest plan with a test card/UPI sandbox → membership becomes active, invoice generated, webhook rows appear in `payment_webhook_events` with outcome `PROCESSED`.
4. Replay the webhook from the gateway dashboard → outcome `DUPLICATE`, no second invoice.
5. Refund the test payment from Admin → Revenue → Refunds → status becomes *Processed* (after the gateway confirms).
6. Switch the admin Mode to **Live** with live credentials, repeat with a minimal real amount, refund it.
7. Keep a screenshot/log of steps 3–6 as the evidence that flips these items from NOT VERIFIED to VERIFIED.

## 7. Known limits

- Auto-renewal does not charge cards on its own: neither gateway integration stores a reusable mandate here, so the "auto-renew" flag only drives reminders and a "renewal failed → please renew" notice.
- Razorpay Checkout.js is loaded from `https://checkout.razorpay.com` (allowed by the site CSP). PhonePe is a full-page redirect.
- Plans are priced in INR in the seed data. Charging in another currency additionally needs that currency enabled on your Razorpay/PhonePe account; that path has not been exercised.
- GST on invoices uses `GST_RATE_PERCENT` (a placeholder rate; confirm your actual tax treatment with your accountant).
