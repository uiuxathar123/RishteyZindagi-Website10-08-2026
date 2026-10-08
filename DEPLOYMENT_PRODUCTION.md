# Production deployment guide (Production Completion Phase)

This is the operator's runbook for putting RishteyZindagi on a real server. It **supplements** `DEPLOYMENT.md` (B14), whose sections on migrations, rollback and the pre-deploy backup still apply; where the two disagree (storage, rate limiting, payment webhooks, scheduling, first admin) **this file wins**.

> **Honesty note.** No real deployment has been performed from this repository. Every command below was executed in the build sandbox against a local PostgreSQL 16, local mock gateways and a local S3 emulator (moto), never against real hosting, real payment/SMS/e-mail vendors or a real domain. Items that depend on those are marked **REQUIRES EXTERNAL CREDENTIALS** and listed in `PCP_RELEASE_READINESS_MATRIX.md`.

---

## 1. What you need

| Need | Notes |
|---|---|
| A Linux host or container platform able to run a long-lived Node.js 20+ process (built and tested on Node 22) | `next start` is the server. There is no separate worker process. |
| PostgreSQL 16 | Managed (preferred) or self-run. The only stateful component besides object storage. |
| Reverse proxy / load balancer with TLS | nginx, Caddy, Cloudflare, an ALB… It must overwrite or append `X-Forwarded-For` (see §4). |
| S3-compatible bucket (private) | AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO… Local disk works but is single-server and has no off-box copy. |
| A scheduler | System cron, a container cron job, or a platform scheduler (§6). |
| Vendor accounts | Razorpay and/or PhonePe, Fast2SMS and/or an SMTP relay. Optional: WhatsApp Cloud API, Firebase (FCM). |

## 2. Configure the environment

1. Copy `.env.example` into your host's secret store / environment — **do not** put a `.env` file with real values in git or in any export.
2. Fill the variables in `PRODUCTION_ENV_REFERENCE.md`. The minimum for a working site: `NODE_ENV=production`, `DATABASE_URL`, `APP_URL` (https), `AUTH_SECRET`, `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `TRUST_PROXY_HOPS`, `STORAGE_PROVIDER=s3` + `STORAGE_BUCKET` + `S3_*`, one OTP provider (SMTP or Fast2SMS), `CRON_SECRET`.
3. Run the pre-flight (no network, no DB writes):

```
npm ci
npm run check:prod-env
```

It must print `RESULT: OK`. Read every warning; the ones that matter for go-live are `TRUST_PROXY_HOPS`, `CRON_SECRET`, `APP_URL` and "no OTP channel configured".

## 3. First deployment

```
npm ci
npm run build                      # needs the environment present (at least DATABASE_URL and AUTH_SECRET — Next.js loads every API route to collect page data and the env is validated; the placeholders from .env.example are enough for the build step). CSP_IMG_SRC_EXTRA (if any) must be set here too
npm run db:migrate                 # applies drizzle/0000 … 0011
npm run db:seed                    # roles, permissions, reference data, gateways and PLACEHOLDER membership plans (no dev admin outside development)
npm run admin:create-super -- --email owner@yourdomain --name "Site Owner"
npm start                          # binds PORT (default 3000)
```

**Before opening the site, set the real membership plan prices.** The seed inserts placeholder plans (e.g. ₹4,499 for 6 months) and there is no admin screen for plans yet (see `PCP_KNOWN_LIMITATIONS.md`, P2-3): edit `membership_plans.price_in_paise` (and `is_active` to hide plans) with SQL. **Re-running `npm run db:seed` resets each plan's name, currency, duration, price and features to the seed values** (it upserts by plan code), so after any later upgrade that needs a re-seed (e.g. new permissions), re-apply your prices afterwards.

`admin:create-super` prints a 16-character temporary password **once**. Sign in at `/admin/login`; the panel immediately forces you to choose your own password (≥ 10 characters) before anything else is available. It refuses to run if a Super Admin already exists (use **Admin → Staff & Roles** for everyone else) and writes an audit entry without the password. Do not set `SEED_DEV_SUPER_ADMIN` in production — `check:prod-env` fails if you do.

Back up before every later migration (`DEPLOYMENT.md` §6, now using `scripts/backup-secure.sh`, see `BACKUP_DR.md` addendum).

## 4. Reverse proxy, TLS, headers

- Terminate TLS at the proxy and forward to `http://127.0.0.1:3000`. Redirect http→https. The app sends HSTS (production) and sets `Secure` on session cookies.
- **`TRUST_PROXY_HOPS`**: set it to the number of proxies you operate in front of the app (usually `1`). The client IP used for rate limiting and audit is the Nth entry from the right of `X-Forwarded-For`. If you leave it unset the left-most entry is used, which any client can forge — rate limits could then be evaded by rotating a fake header. VERIFIED by test: with `TRUST_PROXY_HOPS=1` rotating forged headers does not evade the limit.
- Pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. The same-origin CSRF check on `/bff/*` compares `Origin` with `X-Forwarded-Host`/`Host`, so the proxy must not rewrite `Host` to something other than the public name.
- Security headers on pages: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS and a baseline `Content-Security-Policy` (section 9 of `PCP_KNOWN_LIMITATIONS.md` explains why `script-src` still contains `'unsafe-inline'`). API responses get their own headers from `src/middleware.ts`.
- Do **not** expose `/api/v1/internal/jobs/*` publicly unless you rely on `CRON_SECRET`; the simplest posture is to block `/api/v1/internal/` at the proxy and run jobs via the CLI (§6).

## 5. Webhooks and return URLs

Register at the gateways (exact URLs are also shown in **Platform Settings → Payment gateway**):

| Gateway | URL |
|---|---|
| Razorpay | `https://<domain>/api/v1/webhooks/razorpay` |
| PhonePe | `https://<domain>/api/v1/webhooks/phonepe` |
| PhonePe return | `https://<domain>/membership/payment-return?paymentId=…` (generated by the app) |

Details and the first-live-payment checklist: `PAYMENT_SETUP.md`. Webhook routes are public by design and authenticated by signature/credentials; the proxy must pass the **raw body** unmodified (no body rewriting, no compression middleware that re-encodes JSON).

## 6. Scheduled jobs

Six idempotent jobs; each takes a Postgres advisory lock (a second concurrent run is skipped, not duplicated), records a row in `job_runs` and an audit entry.

| Job | Schedule | Purpose |
|---|---|---|
| `membership-expiry` | `*/15 * * * *` | Expire ended memberships; notify once. |
| `membership-reminders` | `5 * * * *` | 7-day and 3-day renewal reminders (once each). |
| `membership-renewal-failed` | `*/30 * * * *` | Tell members whose auto-renew membership expired that renewal needs their action. (The platform cannot charge unattended.) |
| `payment-reconcile` | `*/10 * * * *` | Settle stale PENDING payments/refunds from the gateway; close unpaid expired orders; flag late captures. |
| `account-deletion-finalize` | `30 2 * * *` | Anonymise accounts past the recovery window; remove their photos. |
| `housekeeping` | `17 * * * *` | Prune rate-limit counters, webhook-idempotency rows, old job history. |

Option A — CLI from cron (recommended; needs no network exposure):

```
*/15 * * * *  cd /srv/rishteyzindagi && npm run job -- membership-expiry
*/10 * * * *  cd /srv/rishteyzindagi && npm run job -- payment-reconcile
# … one line per job above
```

Option B — HTTP, from a platform scheduler: set `CRON_SECRET` (≥ 32 chars) and call `POST https://<domain>/api/v1/internal/jobs/<job>` with `Authorization: Bearer <CRON_SECRET>`. Without the secret the endpoint answers 404.

List jobs and schedules: `npm run job -- --list`. Exit code is non-zero if a job FAILED. The app does not need a permanent background process; if you never schedule anything, memberships simply stop expiring and payments stop reconciling — schedule them.

## 7. Object storage

Set `STORAGE_PROVIDER=s3` and the `S3_*` variables. Objects are private and never public-read; the app serves photos and invoices only through its own authenticated routes (`/profiles/me/photos/:id/file`, `/invoices/:id/download`), and the provider can mint SigV4 pre-signed GET URLs of at most 15 minutes where direct access is ever needed. Uploads are validated by magic bytes and size, keys are generated by the server from an allow-list (no path traversal), and deleting a photo/account deletes the object. https is required in production. **Connectivity is not verified at boot** — `GET /api/v1/health/ready` reports `storageProvider: configured` when the variables are present, which does not prove the bucket accepts the credentials. After deploy, upload a photo through the UI and confirm the object appears in the bucket (**REQUIRES EXTERNAL CREDENTIALS**).

Migrating existing local-disk files to S3 is not automated; for a fresh launch this does not apply.

## 8. Post-deploy checks

1. `curl -f https://<domain>/api/v1/health/ready` → HTTP 200, `data.checks.database` = `connected`; `status` = `ok` once an OTP channel and storage are configured.
2. Sign in to `/admin/login`, change the temporary password, open **Platform Settings**: payment gateway and OTP provider cards show "complete" for what you configured.
3. Sign up a test member, receive a real OTP, upload a photo, buy a plan with test credentials (`PAYMENT_SETUP.md` §6), verify a webhook row appears, then run `npm run job -- payment-reconcile` and `npm run job -- membership-expiry` once and check `job_runs`.
4. Check response headers on `/` and `/admin/login` (CSP present, HSTS present) and that cookies are `Secure; HttpOnly`.
5. Run a backup and a restore verification (`BACKUP_DR.md` addendum) **before** inviting users.

## 9. Operating

- Logs: one JSON line per request, secrets redacted. Alert on `statusCode >= 500` rates, `/health/ready` non-200, and webhook rows with outcome `FAILED` in `payment_webhook_events`.
- Admin audit trail: **Admin → Audit Log** (every payment switch, OTP switch, staff change, moderation action, refund, job run).
- Rotating secrets: `AUTH_SECRET` (signs everyone out), `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` (re-enter gateway credentials afterwards), `CRON_SECRET` (update the scheduler), gateway/OTP/S3 keys (update env or the admin screen).
- Rollback: `DEPLOYMENT.md` §7. Migration `0011` is additive only (new tables/columns), so rolling the application back leaves it harmlessly in place.
