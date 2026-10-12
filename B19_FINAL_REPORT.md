# B19 — Super Admin controls, content, groups, live chat — Final report

Environment: PostgreSQL 16 (local), Node 22, Next.js 14.2.35, Chromium (Playwright) for browser checks. **Every third party (Razorpay, PhonePe, Fast2SMS, SMTP, storage) was a local mock.** No live payment was made, no real customer data was used, and no secret appears in this report or in the ZIP.

Baseline: B18 final (see `B18_FINAL_REPORT.md`). Result: **166 API routes, 51 pages, 66 tables, 19 migrations, 5 scheduled-job definitions, 86 test files / 786 tests.**

## 1. Scope delivered

Requested: platform toggles, admin MFA, content & support admin, dashboard & security upgrades, and "everything buildable in the web app". Excluded by you: the Android app and live-provider verification.

| # | Feature | Result | Evidence |
|---|---|---|---|
| 1 | Maintenance mode (Super Admin; Admin Panel, health, webhooks, jobs, `/site-status` stay up) | PASS (local) | `b19-site-controls`; smoke 20–27 |
| 2 | Manual profile approval + Visibility Queue | PASS (local) | `b19-site-controls` |
| 3 | Admin MFA (e-mailed code, break-glass CLI) | PASS (mock SMTP) / real SMTP **BLOCKED** | `b19-admin-mfa`; smoke 30–34 |
| 4 | Support-contact store, public contact form, admin inbox | PASS | `b19-content`; smoke 40–42 |
| 5 | Success-stories CMS (publishing needs recorded consent; nothing seeded) | PASS | `b19-content` |
| 6 | Dashboard time-series charts | PASS | `b19-dashboard-security`; smoke 90 |
| 7 | Security-events CSV export (formula-injection safe) | PASS | `b19-dashboard-security`; smoke 91 |
| 8 | Delegable Plans / Communities screens (fixes B18-P3-1) | PASS | `b19-dashboard-security` |
| 9 | Change e-mail / mobile (password + code to the new contact; other sessions signed out) | PASS (mocks) / real SMTP & SMS **BLOCKED** | `b19-contact-change`; smoke 80–82 |
| 10 | Weekly e-mail digest (opt-in, counts only, one per ISO week, master switch) | PASS (mock SMTP) / real SMTP **BLOCKED** | `b19-digest`; smoke 70–73 |
| 11 | Live chat over Server-Sent Events (polling fallback kept) | PASS | `b19-chat-stream`; smoke 50–54 |
| 12 | Community groups (member side + admin moderation) | PASS | `b19-groups`; smoke 60–67 |
| 13 | Renewal follow-up (dunning) groundwork | PASS — reminders only | `b19-dunning`; smoke 74, 92 |

## 2. What is NOT built, or not what the name suggests

* **Chat is Server-Sent Events, not a WebSocket.** Next.js route handlers cannot host WebSockets. The stream is backed by a database poll (1.5 s), so it is correct across several app instances but is not a push bus.
* **No automatic charging / recurring billing.** Nothing stores a card, token or mandate. The renewal job only sends reminders and tracks a follow-up state. True auto-debit needs Razorpay Subscriptions / e-mandate or PhonePe Autopay.
* **Security-event alerting** — not built (export and trends exist).
* **Android app** — not built (outside the web app).
* **Live-provider verification** — see section 4.

## 3. Verification run (all local, mocks only)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Production build (`next build`) | OK |
| Full suite, final clean run (`vitest run`) | **86 files, 786/786 tests passed** |
| B19 real-HTTP smoke against a production build | 57/57 |
| B18 smoke / PCP prod smoke / PCP gateway smoke | 114/114, 123/123, 52/52 |
| Browser checks (`smoke:ui`, `smoke:b18-ui`) | 42/42, 42/42 |
| Secret scan of the export tree | OK — 833 files, nothing found |

Correction: an earlier progress message said "782 of 786" tests passed. The first full run actually gave 780 passed / 6 failed; the 6 were fixed (see section 5) and the final clean run is 786/786.

New B19 test files (52 tests): `b19-site-controls` 6, `b19-admin-mfa` 6, `b19-content` 5, `b19-dashboard-security` 6, `b19-contact-change` 4, `b19-digest` 8, `b19-chat-stream` 6, `b19-groups` 7, `b19-dunning` 4.

## 4. BLOCKED — cannot be verified in this sandbox

Razorpay, SMTP, Fast2SMS and PhonePe were exercised **only against local protocol mocks**. They are not claimed to work. The e-mail features (admin MFA, contact change, digest) and the SMS path of contact change depend on them. To verify on your machine with **test** keys only:

1. Put the test credentials in your local ignored `.env`.
2. Run `npm run check:providers -- --to <your-mailbox> --create-test-order`.
3. Do not switch to live payments.

## 5. Existing tests and files changed (disclosure)

Frozen-phase source files touched are listed in `B19_KNOWN_LIMITATIONS.md` (visibility now also requires `approvalStatus = APPROVED`, which is a no-op while manual approval is off; central maintenance check in the error handler; additive OTP purposes; two-step admin login only when MFA is on).

Existing tests edited, and why:

* `b18-permission-matrix.test.ts` — +19 rules (a rule is required for every admin route).
* `pcp-security.test.ts` — 5 new public routes added to the allow-list (`admin/login/verify-mfa`, `contact`, `support-contact`, `success-stories`, `site-status`).
* `b18-member-settings.test.ts` — notification prefs now include `DIGEST:false`.
* `db.test.ts` — table count 58 → 66 with the 8 new names.
* `scripts/smoke/b18-ui-check.ts` — check S7 asserted the old "Changing email or mobile number" placeholder; it now asserts the two real "Change e-mail / Change mobile" controls.

Defects found and fixed during verification: a test granted a permission without revoking it (broke an unrelated suite via the shared DB; now try/finally); the digest smoke blocked its own mock SMTP with a synchronous child process (now async); a duplicate-label clash in the browser check (label renamed to "Weekly summary").

## 6. Operating notes

* Schedule the new jobs yourself: `member-digest` (suggested `30 3 * * 1`) and `membership-dunning` (suggested `15 * * * *`), via `npm run job -- <name>`.
* Admin locked out of MFA: `npm run admin:disable-mfa`.
* Groups are moderated after the fact; staff the *Community Groups* screen before opening them to the public.
* Full limitation list: `B19_KNOWN_LIMITATIONS.md`. Readiness table: `B19_RELEASE_READINESS_MATRIX.md`. API: `API_REFERENCE.md` §22.

No Git repository was initialised and nothing was pushed. `RishteyZindagi_PCP_FINAL.zip` is untouched.
