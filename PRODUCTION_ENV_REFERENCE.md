# Production environment variable reference

Source of truth: `src/server/config/env.ts` (validated at start-up by `getEnv()`), plus `ALLOWED_ORIGINS`, `RATE_LIMIT_POLICY`, `INTERNAL_API_ORIGIN` and `CSP_IMG_SRC_EXTRA`, which are read directly. A copy-paste template with placeholders only is `.env.example`. **Never commit a real value; the clean-export check (`FINAL_HANDOVER.md`) scans for secrets.**

Run `npm run check:prod-env` against the production environment before every deployment. It makes no network call and no database connection; it exits non-zero on errors and prints warnings.

Legend — **Req**: ✔ = required for a working production deployment; ◐ = required only if you use the feature; ○ = optional. **Secret**: ● = treat as a secret (secrets manager / host env, never in git).

## Core

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `NODE_ENV` | ✔ | | Must be `production`. Turns on every production guard (no mock gateways, no dev OTP mode, Secure cookies, HSTS, CSP, https enforcement for S3). |
| `DATABASE_URL` | ✔ | ● | PostgreSQL 16 connection string. Use a least-privilege role; use TLS (`?sslmode=require`) for managed databases. |
| `APP_URL` | ✔ | | Public https origin, e.g. `https://rishteyzindagi.example`. Used for webhook URLs shown in the admin panel and the PhonePe return URL. `check:prod-env` warns if it is not https. |
| `API_URL` | ○ | | Informational. |
| `AUTH_SECRET` | ✔ | ● | ≥ 32 random chars (`openssl rand -hex 32`). HMAC key for session tokens at rest. Rotating it signs everyone out. |
| `SESSION_TTL_HOURS` | ○ | | Default 720 (30 days). |
| `ALLOWED_ORIGINS` | ✔ | | Comma-separated CORS allow-list for the **API** (e.g. a future mobile web origin). Unset = `*` (warned). The website itself is same-origin and does not need CORS. |
| `INTERNAL_API_ORIGIN` | ○ | | Only if the app cannot reach itself on `http://127.0.0.1:$PORT` (container networking). |
| `SEED_DEV_SUPER_ADMIN` / `_EMAIL` / `_PASSWORD` | – | ● | **Must be unset/false in production** (error otherwise). Create the first Super Admin with the procedure in `DEPLOYMENT_PRODUCTION.md` §3. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | ○ | | Shown on /contact. |

## Payments (see `PAYMENT_SETUP.md`)

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | ✔ | ● | 64 hex chars (`openssl rand -hex 32`). Encrypts admin-saved gateway credentials (AES-256-GCM). Losing it = re-enter credentials. Never reuse a dev/test value. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | ◐ | ● | Alternative to saving them in the admin panel. |
| `RAZORPAY_WEBHOOK_SECRET` | ◐ | ● | Must equal the secret on the Razorpay webhook. Without it the webhook returns 503. |
| `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION` | ◐ | ● | PhonePe Payment Gateway v2 OAuth client. |
| `PHONEPE_ENV` | ◐ | | `sandbox` \| `production`. Admin "Mode" overrides; unset ⇒ sandbox (fail-safe). |
| `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD` | ◐ | ● | Must equal the username/password set on the PhonePe webhook. |
| `PAYMENT_PENDING_EXPIRY_MINUTES` | ○ | | 5–1440, default 60. |
| `PAYMENT_PROVIDER_MODE` | – | | `dev` \| `real`. Only for non-production servers; ignored when `NODE_ENV=production`. |
| `GST_RATE_PERCENT` | ○ | | Invoice tax line, default 18 — confirm with your accountant. |
| `RAZORPAY_API_BASE`, `PHONEPE_API_BASE`, `PHONEPE_AUTH_BASE` | – | | Test doubles only. **Ignored in production** so production can never be pointed at a look-alike host by configuration. |
| `CASHFREE_*`, `PAYU_*`, `PAYTM_*`, `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY` | – | | Legacy B8 placeholders; not usable gateways. Leave unset. |

## OTP delivery (see `FAST2SMS_SETUP.md`)

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `SMTP_HOST`, `EMAIL_FROM` | ◐ | | Both needed for Email OTP / e-mail notifications. |
| `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | ◐ | `SMTP_PASS` ● | Port default 587; `SMTP_SECURE=true` for implicit TLS (465). |
| `FAST2SMS_API_KEY`, `FAST2SMS_OTP_ID` | ◐ | `FAST2SMS_API_KEY` ● | Both needed for SMS OTP. |
| `FAST2SMS_API_BASE` | – | | Test double only; ignored in production. |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `SMS_PROVIDER`, `SMS_API_KEY`, `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `PUSH_PROVIDER`, `PUSH_API_KEY` | – | ● | Legacy B2/B7 scaffolds, superseded; leave blank. |

At least one of Email or Fast2SMS must be complete in production, otherwise nobody can sign up (`check:prod-env` and `/health/ready` report it).

## Notifications (optional; every adapter fails safely and never reports a fake delivery)

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (+ the WhatsApp Cloud API token in `WHATSAPP_API_KEY`) | ◐ | ● | In-app notifications are always created; WhatsApp is an extra channel. |
| `WHATSAPP_API_VERSION` | ○ | | |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | ◐ | `FCM_PRIVATE_KEY` ● | Firebase service-account values for push. PEM newlines as `\n`. |

## Object storage (`STORAGE_PROVIDER=s3`)

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `STORAGE_PROVIDER` | ✔ | | `s3` in production (local disk is single-server and has no off-box copy). |
| `STORAGE_BUCKET` | ◐ | | Bucket name. Keep it **private**; the app never makes objects public. |
| `S3_ENDPOINT` | ◐ | | Blank = AWS. R2/MinIO/Spaces: their https endpoint. `http://` is refused in production. |
| `S3_REGION` | ◐ | | e.g. `ap-south-1`; `auto` for R2. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ◐ | ● | Scope the key to the one bucket. |
| `S3_FORCE_PATH_STYLE` | ○ | | `true` for MinIO-style hosts. |

## Rate limiting, proxy, jobs

| Variable | Req | Secret | Notes |
|---|---|---|---|
| `TRUST_PROXY_HOPS` | ✔ | | Number of trusted reverse proxies in front of the app (client IP = Nth-from-right `X-Forwarded-For`). **Set it.** With `0` the left-most entry is used, which a client can forge unless your edge overwrites the header; `check:prod-env` warns. |
| `RATE_LIMIT_STORE` | ○ | | `postgres` (default in production; shared across instances) \| `memory` (single process only). |
| `RATE_LIMIT_POLICY` | – | | Set to `off` **only** in tests; `check:prod-env` fails if it is set to `off`. |
| `CRON_SECRET` | ◐ | ● | ≥ 32 chars. Enables `GET/POST /api/v1/internal/jobs/<job>` with `Authorization: Bearer <secret>`. Unset ⇒ that endpoint is 404 and you must run `npm run job -- <name>` from a scheduler. |
| `ACCOUNT_RECOVERY_WINDOW_DAYS` | ○ | | 1–365, default 30. |

## Build-time

| Variable | Notes |
|---|---|
| `CSP_IMG_SRC_EXTRA` | Space-separated https origins added to the CSP `img-src` (e.g. the bucket/CDN host serving photos). Read when `next build` runs. |

## Backup scripts (not read by the web app)

`BACKUP_DIR`, `BACKUP_ENCRYPTION` (`passphrase`\|`recipient`\|`none`), `BACKUP_PASSPHRASE_FILE`, `BACKUP_GPG_RECIPIENT`, `BACKUP_ALLOW_UNENCRYPTED`, `BACKUP_OFFSITE` (`none`\|`dir`\|`s3`), `BACKUP_OFFSITE_DIR`, `BACKUP_S3_BUCKET/REGION/ENDPOINT/PREFIX/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE`, `VERIFY_ADMIN_DATABASE_URL`, `VERIFY_MIN_TABLES`, `VERIFY_REQUIRED_TABLES` — see `BACKUP_DR.md`.

## Secrets that are never environment variables

Member passwords and admin passwords are stored only as bcrypt hashes; session tokens only as hashes in `device_sessions`; OTP codes only as hashes; admin-saved gateway credentials only as AES-GCM ciphertext. The admin APIs never return a stored secret (the payment/OTP/staff tests assert this on the responses), and `tests/pcp-security.test.ts` runs a static scan of source, the env template and the frontend bundle configuration for secret exposure. A static scan cannot prove a log line is clean in every code path; the specific logging paths for OTP codes, SMTP/SMS bodies and gateway credentials are covered by the module tests.
