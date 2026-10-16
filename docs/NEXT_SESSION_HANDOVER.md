# Next Session Handover

Read this first in any new session. It records where the read-only audit stopped and what to do next, so the work is not repeated.

**Last updated:** 2026-10-17 · **Branch:** `main` at `4262de9`, one commit ahead of `origin/main` (not pushed) · **Mode:** read-only audit, plus one owner-approved fix (D-1).

## 0. Git state at hand-off

| Commit | What | Status |
|---|---|---|
| `5778152` (2026-10-13) | Last commit before this audit | Pushed |
| `4262de9` (2026-10-17) | D-1 fix: contact change returns 403, not 401, for a wrong password or code. Also added `PROJECT_MEMORY.md` and `docs/DECISIONS_AND_CHANGELOG.md` | Committed on `main`, **not pushed** |
| (next) | The other eight audit documents in `docs/` | Committed only with the owner's approval; check `git log` for whether this has happened |

Still untracked and deliberately left alone: `COMMIT_1.txt`, `COMMIT_2.txt`, `PROPOSED_COMMITS.md`, `post-b19-audit.patch`, `gate1/` (see D-10).

## 1. Ground rules the owner set (still in force)

* Read-only by default: do not modify application source, install dependencies, run migrations, or change authentication, payment or database behaviour unless the owner approves that specific change (D-1 was approved this way).
* Do not delete, reset, overwrite or discard user work. Commit only with the owner's explicit approval for that commit; never push or deploy without being asked.
* Never open or print `.env`, `.env.test` or `.env.test.bak-20261009`.
* Stay on `main`; the owner declined a separate branch for this documentation.
* Do not claim a feature works or a performance number without code or test evidence.
* Wait for the owner's approval before implementing any change.

## 2. What this audit has produced

| File | Purpose |
|---|---|
| `PROJECT_MEMORY.md` | One-page orientation: what the system is, key facts, rules, where to look. |
| `docs/FILE_AUDIT_CHECKLIST.md` | Every tracked file with READ / OUTLINED / PATTERN-VERIFIED / PENDING status. |
| `docs/PROJECT_ARCHITECTURE.md` | Verified architecture map (layers, request path, data model, auth, jobs, storage). |
| `docs/FEATURE_INVENTORY.md` | Feature-by-feature status with evidence (code + tests). |
| `docs/QA_BASELINE.md` | Test evidence, what it covers, and what is not verified. |
| `docs/PERFORMANCE_ROADMAP.md` | Performance findings from code reading, with a proposed order. Nothing here is measured. |
| `docs/MOBILE_APP_ROADMAP.md` | Android readiness of the API and the gaps. |
| `docs/PERSONAL_MATCHMAKING_SPEC.md` | Draft specification. The feature does not exist in code. |
| `docs/DECISIONS_AND_CHANGELOG.md` | Decisions the owner needs to make, plus a log of this audit. |

## 3. Coverage at hand-off

From `docs/FILE_AUDIT_CHECKLIST.md`: **110 READ, 73 OUTLINED, 166 PATTERN-VERIFIED (API routes), 469 PENDING** of 818 listed files. The eight other audit documents are not in the list yet; add them the next time it is regenerated.

Fully covered: root config, the request pipeline (BFF, middleware, auth, RBAC, rate limiting, maintenance), server `lib/` and `config/`, the database schema, all 19 migrations, the auth and OTP modules, account settings/deletion/contact change, admin login and staff management, search, privacy rules, payments service.

Outlined only: recommendations, profiles service, interactions, moderation/reports/warnings, webhooks, invoices, memberships, notifications, chat, groups, content, jobs, storage.

## 4. Exact next steps (in this order)

0. **Verify the D-1 fix beyond its own test:** run the full suite (`npm test`, about 28 minutes, needs the migrated and seeded test database) and try a wrong password and a wrong code in Dashboard → Settings → change e-mail; the member must stay signed in and see "That password is not correct." / "That code is invalid or has expired." Only `tests/b19-contact-change.test.ts` (4/4) and `npx tsc --noEmit` have been run so far.
1. **Server modules still PENDING** (about 101 files): read controllers and repositories under `src/server/modules/` that are PENDING in the checklist. Priorities: `profiles/profiles.controller.ts`, `profiles/profiles.repository.ts`, `interactions/interactions.repository.ts`, `payments/payments.repository.ts`, `payments/payments-pcp.repository.ts`, `payments/credentials.ts`, `payments/gateways.service.ts`, `payments/payment-config.service.ts`, `payments/providers/phonepe.provider.ts`, `invoices/invoice-pdf.ts`, `admin/users-admin.*`, `admin/security-events.service.ts`, `notifications/providers/*`. Also finish reading `jobs/definitions/payments.ts` (OUTLINED): its header says reconcile handles stale PENDING payments and late captures on FAILED ones; confirm nothing repairs a SUCCESS payment whose membership was never activated (D-6).
2. **Frontend** (about 199 PENDING files): start with `src/app/dashboard/layout.tsx`, `src/app/admin/(panel)/layout.tsx`, `src/components/dashboard/DashboardShell.tsx`, `src/components/admin/AdminShell.tsx`, `src/components/auth/*`, `src/components/membership/CheckoutClient.tsx`, then the remaining admin and dashboard components.
3. **Tests** (95 PENDING): read the test names (`grep -n "it(\""`) per file and map them into `docs/QA_BASELINE.md` §4.
4. **Older documents** (46 PENDING): only check them for contradictions with code (the B18 interests claim in D-3 is one example). Do not rewrite them.
5. Update each new document's "Evidence level" notes as files move from OUTLINED to READ.
6. When the checklist has no PENDING rows, mark the audit complete in this file and in `PROJECT_MEMORY.md`.

## 5. Findings that need the owner (summary; details in `docs/DECISIONS_AND_CHANGELOG.md`)

* **D-1 (fixed in `4262de9`, not pushed):** a wrong password or code during e-mail/mobile change used to return 401, which made the BFF sign the member out. It now returns 403. Full-suite and browser checks are still outstanding (step 0).
* **D-2:** admin MFA is off by default, and admin sessions last 30 days (same TTL as members).
* **D-3:** the code requires an active membership to send interests; `B18_FINAL_REPORT.md` says interests are free.
* **D-4:** Staff Admins with default permissions can see revenue on the dashboard.
* **D-5:** invoice numbers are timestamps, not a consecutive series; GST is a placeholder.
* **D-6:** payment marked SUCCESS before membership activation and invoice issue (not one transaction).
* **D-7:** SMS OTP works only for Indian +91 numbers; NRIs outside the Gulf pay in INR.
* **D-8:** photo moderation status is stored but not enforced.
* **D-9:** re-running `npm run db:seed` re-grants the default Staff Admin permissions.
* **D-10:** untracked handover files (`COMMIT_*.txt`, `PROPOSED_COMMITS.md`, `post-b19-audit.patch`, `gate1/`) are superseded and could be archived. The owner decides.

## 6. Useful commands (read-only)

```bash
git status --short --branch
git ls-files | wc -l
grep -n "it(\"" tests/<file>.test.ts
```

The last full test log is `vitest-full.log` (UTF-16). Convert it before searching: `iconv -f UTF-16 -t UTF-8 vitest-full.log`.
