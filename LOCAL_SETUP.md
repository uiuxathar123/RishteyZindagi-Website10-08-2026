# RishteyZindagi — Local Setup Guide (Windows / macOS / Linux)

This gets the **complete application** (website + member dashboard + admin panel + REST API + database) running on your own machine. No real secrets are included; you create your own local `.env` files from the provided templates.

> **What you are running.** One Next.js 14 (App Router) + TypeScript project containing (a) the public website, member dashboard and admin panel, and (b) the REST backend under `/api/v1/*` (PostgreSQL + Drizzle ORM). Since phase **B16** the screens are **connected to the real backend** — there is no mock data behind any member or admin screen. The browser talks to a same-origin proxy (`/bff/*`) that keeps the session in an **httpOnly cookie**; the token is never in JavaScript, `localStorage` or the URL.

Three things are **deliberately not live** (nothing is faked — see `FINAL_HANDOVER.md` §21–§25):

1. **OTP delivery** — no SMS/WhatsApp/e-mail vendor is connected. Locally you use the built-in *development mode* (§8) which shows the code on screen.
2. **Payment gateway** — no real gateway SDK is connected. Locally, checkout uses the built-in *dev gateway* and the screen says so.
3. **Cloud storage** — photos/invoices go to local disk (`.storage-local/`).

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
| `EMAIL_*`, `SMS_*`, `WHATSAPP_*`, `PUSH_*`, `RAZORPAY_*`, `CASHFREE_*`, `PAYU_*`, `PHONEPE_*`, `PAYTM_*`, `STORAGE_*` | No | Keys: yes | Leave blank locally (no real vendor integration exists) |
| `GST_RATE_PERCENT` | No | No | Default 18 — a **placeholder**, not verified tax law |

### `.env.test` (automated tests)

Loaded only by `tests/setup.ts`; must point at the **test** database. See `.env.test.example` (`DATABASE_URL`, `NODE_ENV=test`, `AUTH_SECRET`, `SESSION_TTL_HOURS`, `APP_URL`, `API_URL`, 64-hex `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`).

## 5. Run migrations (11 migrations → 52 tables)

```bash
npm run db:migrate
# test database (one-off override of DATABASE_URL):
#   bash:        DATABASE_URL="postgresql://postgres:<password>@localhost:5432/rishteyzindagi_test" npm run db:migrate
#   PowerShell:  $env:DATABASE_URL="postgresql://postgres:<password>@localhost:5432/rishteyzindagi_test"; npm run db:migrate; Remove-Item Env:DATABASE_URL
```

B16 added **no migration**.

## 6. Seed reference data

Seeds admin roles and the 11 permissions, religions, mother tongues, educations, professions, countries, cities, marital statuses, **34 community groups** (B16), report/warning categories, the 5 payment-gateway rows and the 8 membership plans. Idempotent (safe to re-run). **The test suite needs this data in the test database too.**

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

**Staff Admin** (limited: view users, verify profiles, resolve reports): there is no API/UI for creating staff (the panel says so). Insert one row with the project's own bcrypt hashing, e.g.:

```bash
HASH=$(node -e 'console.log(require("bcryptjs").hashSync("ChooseAStrongPassword!",10))')
psql -U postgres -d rishteyzindagi_dev -c "INSERT INTO admin_users (id,name,email,password_hash,role_id) SELECT gen_random_uuid(),'Staff One','staff@example.com','$HASH',id FROM admin_roles WHERE name='STAFF_ADMIN'"
```

## 10. Run the checks

```bash
npx tsc --noEmit     # type-check
npm test             # ~8–12 minutes, needs the migrated + seeded TEST database
npm run build        # production build
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
| `scripts/backup-db.sh`, `restore-db.sh`, `deploy.sh` | Bash scripts (see `BACKUP_DR.md`, `DEPLOYMENT.md`) |

## 13. Photo / invoice storage

Default (`STORAGE_PROVIDER` blank or `local`): files are written under `.storage-local/` (created automatically; git-ignored). Photos are only served through authenticated routes — the browser never receives a raw storage path. Any other `STORAGE_PROVIDER` value makes uploads fail on purpose (no cloud provider is implemented).

## 14. Credentials needed later (not available locally)

OTP vendor (SMS/WhatsApp/e-mail) · payment gateway (Razorpay/Cashfree/PayU/PhonePe/Paytm — one at a time; a real SDK must be written) · push vendor · cloud object storage · secrets manager/KMS · hosting, domain, CI/CD. See `FINAL_HANDOVER.md` §21–§25.

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
