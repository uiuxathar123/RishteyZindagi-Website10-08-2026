# RishteyZindagi — Local Setup Guide (Windows / macOS / Linux)

This gets the **complete application** (website + member dashboard + admin panel + REST API + database) running on your own machine. No real secrets are included; you create your own local `.env` files from the provided templates.

> **What you are running.** One Next.js 14 (App Router) + TypeScript project containing (a) the public website, member dashboard and admin panel, and (b) the REST backend under `/api/v1/*` (PostgreSQL + Drizzle ORM). Since phase **B16** the screens are **connected to the real backend** — there is no mock data behind any member or admin screen. The browser talks to a same-origin proxy (`/bff/*`) that keeps the session in an **httpOnly cookie**; the token is never in JavaScript, `localStorage` or the URL.

> **Production Completion Phase (PCP) update.** The backend now contains real, production-grade adapters for **Razorpay and PhonePe** payments, **Email (SMTP) and Fast2SMS** OTP delivery, **S3-compatible storage**, WhatsApp/FCM notifications, account deletion + recovery, admin moderation, staff management, rate limiting, scheduled jobs and encrypted backups. **None of these has been called against the real vendor** (that needs *your* credentials — status **REQUIRES EXTERNAL CREDENTIALS**; see `PCP_RELEASE_READINESS_MATRIX.md`). On your own machine you can run everything without any vendor:

1. **OTP delivery** — use the built-in *development mode* (§8), which shows the code on screen (refused in production). Or point `SMTP_*` at a local mail catcher such as MailHog/Mailpit.
2. **Payment gateway** — with no Razorpay/PhonePe credentials and `NODE_ENV=development`, checkout uses the built-in *dev gateway* and the screen says so. To exercise the real code paths locally, save **test-mode** credentials from the vendor in **Platform Settings → Payment gateway** (see `PAYMENT_SETUP.md`).
3. **Storage** — photos/invoices go to local disk (`.storage-local/`) unless `STORAGE_PROVIDER=s3` (§13).

---

## 1. Required software

| Item | Version | Notes |
|---|---|---|
| Node.js | **20 LTS or 22** (verified on **v22**) | Next.js 14 needs Node ≥ 18.17 |
| npm | 10.x | Lockfile is npm's `package-lock.json` — use **npm**, not yarn/pnpm |
| PostgreSQL | **16** | Remember the password of the `postgres` user; put `psql` on PATH |
| Git | any recent | Only when you publish to GitHub |
| Git Bash / WSL | optional | Only for `scripts/*.sh` (backup/restore/deploy) |

## 2. Install dependencies

```bash
npm install        # or: npm ci   (installs exactly what package-lock.json pins)
```

## 3. Create the two databases

Tests truncate tables freely, so the test database must never be your dev database.

```bash
psql -U postgres -c "CREATE DATABASE rishteyzindagi_dev;"
psql -U postgres -c "CREATE DATABASE rishteyzindagi_test;"
```

## 4. Environment files

```bash
cp .env.example .env            # Windows: copy .env.example .env
cp .env.test.example .env.test  # Windows: copy .env.test.example .env.test
```

Edit both and replace every placeholder.

### `.env` (dev server, migrations, seed)

| Variable | Required | Secret | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | **Yes** | `postgresql://postgres:<password>@localhost:5432/rishteyzindagi_dev` |
| `AUTH_SECRET` | **Yes** | **Yes** | Long random string (HMAC key for hashing session tokens / OTP codes) |
| `NODE_ENV` | Recommended | No | `development` locally |
| `APP_URL`, `API_URL` | No | No | Defaults `http://localhost:3000`, `http://localhost:3000/api/v1` |
| `SESSION_TTL_HOURS` | No | No | Default 720 |
| `ALLOWED_ORIGINS` | No | No | Empty = CORS open (fine locally). The website itself is same-origin and does not need CORS. |
| `SEED_DEV_SUPER_ADMIN`, `…_EMAIL`, `…_PASSWORD` | For the dev admin | Password: yes | See §9 |
| `INTERNAL_API_ORIGIN` | No | No | **B16.** Only if the app must call itself on a different internal address (reverse proxy / containers). Default `http://127.0.0.1:<PORT>`. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | No | No | **B16.** Shown on `/contact` and the footer. Empty = no address shown (none is invented). Inlined at build time. |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | Only to save gateway credentials | **Yes** | 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SMTP_*`, `FAST2SMS_*`, `RAZORPAY_*`, `PHONEPE_*`, `S3_*`, `STORAGE_*`, `WHATSAPP_*`, `FCM_*`, `CRON_SECRET`, `BACKUP_*` | No | Keys: yes | Leave blank locally unless you want to try a feature with test credentials. Full list and meaning: `PRODUCTION_ENV_REFERENCE.md`. |
| `CASHFREE_*`, `PAYU_*`, `PAYTM_*`, `EMAIL_PROVIDER`, `SMS_PROVIDER`, … | No | | Legacy placeholders from earlier phases; not usable, leave blank. |
| `GST_RATE_PERCENT` | No | No | Default 18 — a **placeholder**, not verified tax law |

### `.env.test` (automated tests)

Loaded only by `tests/setup.ts`; must point at the **test** database. See `.env.test.example` (`DATABASE_URL`, `NODE_ENV=test`, `AUTH_SECRET`, `SESSION_TTL_HOURS`, `APP_URL`, `API_URL`, 64-hex `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`).

## 5. Run migrations (19 migrations → 66 tables)

```bash
npm run db:migrate
# test database (one-off override of DATABASE_URL):
#   bash:        DATABASE_URL="postgresql://postgres:<password>@localhost:5432/rishteyzindagi_test" npm run db:migrate
#   PowerShell:  $env:DATABASE_URL="postgresql://postgres:<password>@localhost:5432/rishteyzindagi_test"; npm run db:migrate; Remove-Item Env:DATABASE_URL
```

Migration `0011_pcp_production_completion.sql` (Production Completion Phase) adds five tables (`account_bans`, `job_runs`, `payment_refunds`, `payment_webhook_events`, `rate_limit_counters`) plus additive columns; nothing existing is dropped.

Migration `0012_b18_admin_controls.sql` (B18) adds `platform_settings`, `communities.is_active`, `profiles.public_id` (+ sequence, backfilled), the three profile privacy columns, `users.notification_preferences`, and the `plans.manage` / `communities.manage` permissions. **Run `npm run db:migrate` (and `npm run db:seed`) on every existing database after pulling B18**, including your development database.

## 6. Seed reference data

Seeds admin roles and the permissions (including `staff.manage`, `users.ban`, `users.suspend`, `platform.settings.manage`, `payments.review`, `audit.view`), religions, mother tongues, educations, professions, countries, cities, marital statuses, **34 community groups** (B16), report/warning categories, the payment-gateway rows (Razorpay is marked active but has no credentials, so checkout fails closed until you configure it) and the 8 membership plans (**placeholder prices** — re-running the seed resets them). Idempotent (safe to re-run). **The test suite needs this data in the test database too.**

```bash
npm run db:seed
# and for the test database (same one-off override as §5)
```

## 7. Start the app

```bash
npm run dev          # http://localhost:3000
```

* Website: `/` · Member area: `/dashboard` (after login) · Admin panel: `/admin/login`
* API health: `/api/v1/health` (liveness) · `/api/v1/health/ready` (readiness)

## 8. Signing up locally (development OTP mode)

> **B18:** a Super Admin can set *New-device login* and *Sign-up verification* to “OTP not required” (Admin → Platform Settings → OTP policy). The default is **required**. Passwords, account status and rate limits still apply in both modes; password reset, account recovery and payments always require their proof. Test both modes locally by flipping the policy and re-running the flow.

No OTP vendor is connected, so by default a real signup cannot receive a code. For local work, turn on the project's own **development mode**:

1. Log in at `/admin/login` as the dev Super Admin (§9).
2. **Platform Settings → One-time passwords → Development mode → ON → Save.**
   (This sets `otp_configs.dev_mode`. It is refused in production by design.)
3. Sign up at `/signup`. On the code screen click **“Show my verification code”** — the code is read from the server's memory (it is never e-mailed, logged or stored). The same box appears for new-device verification, OTP login and password reset.

The reveal route (`/bff/dev/otp-code`) answers **404** whenever `NODE_ENV=production` **or** dev mode is off, so it cannot exist on a live site.

## 9. Admin accounts

There is no default admin. To create the **dev Super Admin**, set in `.env` **before** `npm run db:seed`:

```
NODE_ENV=development
SEED_DEV_SUPER_ADMIN=true
SEED_DEV_SUPER_ADMIN_EMAIL=you@example.com
SEED_DEV_SUPER_ADMIN_PASSWORD=<choose a strong password>
```

It is only created when `NODE_ENV=development` and `SEED_DEV_SUPER_ADMIN=true`. Never enable this outside local development.

**More staff.** Sign in to `/admin/login` as Super Admin and open **Staff & Roles** (under *Super Admin*): create staff accounts (a one-time temporary password is shown once and must be changed at first sign-in), change roles, deactivate, reset passwords, and edit role permissions. There is no SQL step any more.

**Production first Super Admin** (any environment where the dev seed is off): `npm run admin:create-super -- --email you@example.com --name "Your Name"` prints a one-time temporary password; sign in and you are forced to choose your own.

## 10. Run the checks

```bash
npx tsc --noEmit     # type-check
npm test             # ~15–20 min on a 2-core machine (86 test files, 786 tests), needs the migrated + seeded TEST database
npm run build        # production build (needs .env from §4 to exist — a build with no environment fails with "Invalid environment configuration")
```

## 11. Production build locally

```bash
npm run build && npm start
```

`next start` runs with `NODE_ENV=production`, where every dev/mock provider is **structurally disabled**: signup/OTP calls answer “service unavailable” until a real OTP provider exists, checkout reports that no payment gateway is configured, and the dev reveal routes answer 404. Health endpoints, browsing and search still work. In production mode the session cookies are marked `Secure`, so test a local production build in Chrome or Firefox (they accept `Secure` cookies on `http://localhost`; Safari does not). Before any real deployment run `npm run check:prod-env` (see `B16_PRODUCTION_INFRASTRUCTURE.md`).

## 12. Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` / `lint` | Next.js |
| `npm run db:generate` | New Drizzle migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed reference data |
| `npm test` / `npm run test:watch` | Vitest (real PostgreSQL test DB) |
| `npm run check:prod-env` | Read-only production-readiness check of your env vars |
| `npm run admin:create-super -- --email … --name "…"` | First Super Admin on a fresh database |
| `npm run job -- --list` / `npm run job -- <name>` | Scheduled jobs (membership expiry, reminders, payment reconcile, deletion finalize, housekeeping) |
| `npm run smoke:prod` / `smoke:gateway` | Real-HTTP smoke tests against a production build (see §17) |
| `npm run smoke:b18` / `smoke:b18-ui` | B18 HTTP smoke (OTP policy both ways, search, plans, communities, permissions, member settings) and browser check (member / Super Admin / Staff Admin) |
| `npm run smoke:ui` / `smoke:ui-gateway` | Headless-browser checks (need Playwright + Chromium, not repo dependencies) |
| `scripts/backup-secure.sh`, `backup-offsite.ts`, `verify-restore.sh`, `restore-db.sh`, `backup-db.sh`, `deploy.sh` | Bash scripts (see `BACKUP_DR.md`, `DEPLOYMENT_PRODUCTION.md`) |

## 13. Photo / invoice storage

Default (`STORAGE_PROVIDER` blank or `local`): files are written under `.storage-local/` (created automatically; git-ignored). Photos are only served through authenticated routes — the browser never receives a raw storage path. `STORAGE_PROVIDER=s3` selects the S3-compatible provider (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces…): set `STORAGE_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (`S3_FORCE_PATH_STYLE=true` for MinIO). Objects are private and delivered through short-lived signed URLs or authenticated routes. Uploads are checked for size and real file type (magic bytes). Any other value makes uploads fail on purpose. Reachability of your bucket is **not** verified by `/health/ready` (configuration only) — upload a photo after deploying.

## 14. Credentials needed later (not available locally)

SMTP account · Fast2SMS API key + OTP route · Razorpay and/or PhonePe merchant credentials and webhook secrets (exactly one gateway is active at a time) · WhatsApp Cloud API / Firebase service account (optional) · S3-compatible bucket · off-box backup target and backup passphrase · hosting, domain, TLS, a scheduler for the jobs. Step-by-step: `PAYMENT_SETUP.md`, `FAST2SMS_SETUP.md`, `DEPLOYMENT_PRODUCTION.md`, `BACKUP_DR.md`.

## 15. Putting it on GitHub

The folder is Git-ready: `.gitignore` excludes `.env*` (except the two `*.example` templates), `node_modules/`, `.next/`, `.storage-local/`, logs, backups and key files.

```bash
git init
git add .
git status        # confirm no .env / node_modules / .next is listed
git commit -m "Initial commit"
```

Nothing has been initialised or pushed for you.

## 16. Troubleshooting

* `DATABASE_URL is not set` / invalid environment → `.env` missing or not in the project root.
* Tests fail immediately on connection → PostgreSQL not running, wrong password in `.env.test`, or test DB not migrated/seeded.
* “relation does not exist” → run `npm run db:migrate` against the right database.
* Signup says the service is unavailable → dev mode is off (§8) or you are running a production build.
* Signup works but “Show my verification code” never appears → dev mode is off, or `NODE_ENV=production`.
* Dashboard keeps sending you to `/login` → your session expired or was revoked (password reset / “log out of all devices”).
* Port 3000 busy → `npx next dev -p 3001`.

## 17. Optional: run the real-HTTP smoke tests

These start a production build of this app, a local protocol mock of each vendor, and drive the real HTTP API. They need the migrated **test** database (`.env.test`) and use only mocks — no real vendor is contacted.

```bash
npm run build
export ADMIN_DATABASE_URL=postgresql://postgres:<password>@localhost:5432/postgres   # a role that may CREATE/DROP DATABASE; each run uses a throw-away database
npm run smoke:prod       # 123 checks: auth, OTP via mock SMTP (STARTTLS), RBAC, IDOR, headers, rate limits, jobs, deletion/recovery, moderation, staff
npm run smoke:b18       # 114 checks: B18 features end to end, incl. OTP-required AND OTP-not-required configurations
npm run smoke:gateway    # 52 checks: Razorpay + PhonePe orders, signatures, webhooks, refunds, gateway switching
# browser checks (install Playwright without saving it to package.json):
npm i --no-save playwright && PLAYWRIGHT_MODULE=playwright PLAYWRIGHT_CHROMIUM=/path/to/chromium npm run smoke:ui
```

Logs and screenshots go to the directory named by `SMOKE_LOG_DIR` / `SMOKE_SHOTS_DIR` (see the header of `scripts/smoke/run-smoke.sh`).


## Razorpay TEST mode + SMTP e-mail OTP

See **`PROVIDER_TEST_SETUP.md`** for the variable names, dashboard steps, `npm run check:providers`, safety rails and test commands.


## Git

See **`GIT_HANDOVER.md`** — first-commit checklist and the secret scanner (`npm run scan:secrets`, `npm run hooks:install`).

## 18. Scheduling `member-digest` and `membership-dunning` (B19)

The app has no built-in scheduler. Nothing runs until you schedule it. Both jobs are safe to run by hand first:

```bash
npm run job -- --list                 # shows every job and its suggested schedule
npm run job -- member-digest          # one run now; prints a JSON result (sent / empty / failed / skipped)
npm run job -- membership-dunning
```

Exit code is 0 on success (including "skipped"), 1 if the job failed.

| Job | Suggested schedule | What it needs |
|---|---|---|
| `member-digest` | `30 3 * * 1` (Mondays 03:30) | SMTP configured (`SMTP_HOST`, `EMAIL_FROM`, …), the digest master switch on (Admin → Site controls), and members who opted in under Settings → Notifications. With SMTP missing it **skips** and says so; it does not fake a send. |
| `membership-dunning` | `15 * * * *` (hourly at :15) | Nothing external. It only reads/updates the `renewal_cycles` table and creates in-app notices. |

Example crontab (Linux/macOS), using the CLI option from `DEPLOYMENT_PRODUCTION.md` §6:

```
CRON_TZ=Asia/Kolkata
30 9 * * 1  cd /srv/rishteyzindagi && npm run job -- member-digest
15 * * * *  cd /srv/rishteyzindagi && npm run job -- membership-dunning
```

**Timezone.** The schedule itself is interpreted in whatever timezone your scheduler uses (cron uses the server's, unless it supports `CRON_TZ`; most containers are UTC, where `30 3 * * 1` means 09:00 India time on Monday). Inside the app, "this week" for the digest is the ISO week in **Asia/Kolkata**, so pick a time well away from Monday 00:00 India time (Sunday 18:30 UTC). Dunning measures elapsed time (3 days to the follow-up, 10 days to close) with the database clock, so its timezone does not matter.

**Duplicate runs.** Running a job twice, or from two schedulers at once, is safe:

* `member-digest` claims one row per member per ISO week (`digest_log`) before sending, so nobody gets two digests in a week. A send that failed is retried on the next run in the same week; a member with nothing to report is marked "empty" and is not retried that week. A run that was interrupted mid-send is picked up after one hour.
* `membership-dunning` moves each renewal cycle forward with conditional updates and a per-membership dedupe key, so each member receives at most one follow-up.
* Every job also takes a Postgres advisory lock; a second concurrent run is skipped.

Windows: use Task Scheduler to run `npm run job -- member-digest` in the project folder weekly and `npm run job -- membership-dunning` hourly.

## Local helpers: "I can't sign in / sign up / see profiles in search"

Three commands (local development only — they refuse to run when `NODE_ENV=production` or when `DATABASE_URL` is not on this machine):

```bash
npm run dev:doctor                 # read-only report: DB, Super Admin, SMTP/OTP, and exactly why profiles are or are not in search
npm run dev:setup                  # runs migrate/seed if needed, resets the dev Super Admin (password = SEED_DEV_SUPER_ADMIN_PASSWORD in .env),
                                   # creates 4 fake test members with COMPLETE, approved profiles + a photo + an active membership
npm run dev:setup -- --no-otp      # same, and also switches the sign-up and new-device OTP checks OFF (no SMTP needed)
npm run dev:otp -- off             # switch those two OTP checks off / back on later:  npm run dev:otp -- on
```

Test members (created by `dev:setup`, password `TestPass@12345`): `test.priya@example.com`, `test.aisha@example.com`, `test.rahul@example.com`, `test.imran@example.com`.

Why search can be empty: a profile appears only when it is **complete, has a photo, is approved** (automatic unless "manual approval" is on in Admin → Site controls) **and visible**, and the member's account is ACTIVE. `dev:doctor` counts profiles stuck in each state.

The same OTP switch is available in the admin panel: Admin → Settings → OTP policy ("Sign-up contact verification"). With it off, new accounts are created with e-mail/mobile **unverified** — keep it on for production.

### Registration OTP switch (Super Admin)

Sign in at `/admin/login` → **Platform Settings** (`/admin/super/settings`) → card **"Registration OTP verification"**.

- **ON** (default): new members must enter the one-time code. If e-mail delivery is not configured the sign-up form shows
  "Email OTP delivery is not configured. Set SMTP_HOST and EMAIL_FROM." and nothing is bypassed.
- **OFF**: new accounts are created without a code and nothing is e-mailed (e-mail/mobile stay marked unverified).
  Switching OFF asks for a short reason (kept in the audit log); switching back ON needs none.

The value is stored in the database (`platform_settings`, key `otp.policy`) and survives restarts.
`npm run dev:otp -- off|on` and `npm run dev:setup -- --no-otp` change the same setting (registration only;
add `--all` to also switch the new-device login check). Password reset, admin sign-in/MFA and contact changes always need their code.
