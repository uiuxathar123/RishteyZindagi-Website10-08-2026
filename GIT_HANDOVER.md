# Git handover checklist

The folder is **not** a Git repository yet, and nothing here pushes anywhere. These steps make the first commit safe. Do them on your machine.

## 1. What must never be committed (already in `.gitignore`)

`.env`, `.env.test` and every other `.env.*` (only `.env.example` and `.env.test.example` are tracked), `*.pem` / `*.key` / `*.p12`, database dumps and encrypted backups (`*.dump`, `*.sql.gz`, `*.gpg`, `*.pass`), logs, export archives (`*.zip`, `*.sha256`), `.storage-local/` (uploaded photos and generated invoices), `node_modules/`, `.next/`.

## 2. First commit

```bash
git init -b main
npm run hooks:install          # pre-commit hook: blocks commits that contain secrets
git add -A
git status --short             # eyeball it: no .env, no .storage-local, no *.zip
npm run scan:secrets -- --staged
git commit -m "Initial import"
```

Then, when you are ready (not done for you): `git remote add origin <your-repo-url>` and `git push -u origin main`. Create the remote repository **private**.

## 3. What the secret scan does (`npm run scan:secrets`)

* Refuses forbidden files (`.env*`, keys, dumps, logs, archives, local runtime data) and live-credential patterns (Razorpay `rzp_live_…`, private-key blocks, AWS/Stripe/Slack/Google/GitHub tokens).
* If your local `.env` / `.env.test` exist, it also refuses any file that contains one of **your** real secret values (database password, `AUTH_SECRET`, SMTP password, Razorpay secret, …). It prints only the file name and the value's length — never the value.
* `--staged` (pre-commit hook) checks what you are about to commit; no flag checks everything tracked or not ignored; `--dir <folder>` checks a folder, e.g. an export folder before you zip it.
* Harmless test fixtures can be listed in `.secretscan-allow` (currently `test-only-secret`).

## 4. Before you share or deploy

* Make a ZIP only from a folder that passes `npm run scan:secrets -- --dir <folder>` (build it without `.env*`, `.next`, `node_modules`, `.storage-local`).
* If a real secret ever reaches a commit, rotate it (new Razorpay key, new SMTP app password, new `AUTH_SECRET`, new database password) — deleting the file is not enough once it is in Git history.
* Production needs its own environment (`.env.example` → your host's secret store) and `npm run check:prod-env`; Razorpay TEST keys are refused in production by design.
