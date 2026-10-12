# B18 — Release readiness matrix

Legend: **VERIFIED** = exercised by an automated test and/or a real-HTTP / headless-browser check in this phase (all third parties mocked locally). **REQUIRES EXTERNAL CREDENTIALS** = code and local mock tests exist; never run against the real vendor. **NOT BUILT** = absent and documented. Evidence ids refer to `tests/b18-*.test.ts`, `scripts/smoke/b18-smoke.ts` (HTTP) and `scripts/smoke/b18-ui-check.ts` (browser).

| Area | Feature | Status | Evidence |
|---|---|---|---|
| OTP policy | Super Admin switch for **new-device login** and **sign-up verification**: `OTP_REQUIRED` (default) / `OTP_NOT_REQUIRED`, with reason, who/when/previous/new recorded | VERIFIED | `b18-otp-policy.test.ts`; smoke O*/L*; browser O1–O3, L1–L4, G1–G4 |
| OTP policy | Password reset, account recovery, OTP-only login, admin login, payments can **never** be made OTP-less | VERIFIED | `b18-otp-policy.test.ts` (unknown workflow → 400); smoke |
| OTP policy | Staff Admin (even holding `platform.settings.manage`) cannot change it; members cannot; no session / direct API call bypasses it | VERIFIED | `b18-escalation.test.ts` `[esc-super-only-settings]`; `b18-permission-matrix.test.ts` |
| OTP policy | Not-required never bypasses password, account status, session validation | VERIFIED | `b18-otp-policy.test.ts`; browser L3 (wrong password refused) |
| OTP policy | Any doubt (missing/corrupt setting) → `OTP_REQUIRED` | VERIFIED | `b18-otp-policy.test.ts` |
| OTP provider | One active provider (EMAIL **or** SMS), separate from policy | VERIFIED (mock SMTP/Fast2SMS) | existing B-phase tests; `b18-otp-policy.test.ts` independence test |
| Search | Profile-ID search (`RZ########`), filters, sort, pagination, wildcard-safe text | VERIFIED | `b18-search.test.ts`; smoke |
| Search | Advanced search = plan entitlement, enforced server-side (403 with `details.entitlement`) | VERIFIED | `b18-search.test.ts`; smoke; `GET /search/access` |
| Search | Privacy: hidden profiles invisible, photo visibility, last-active coarse labels | VERIFIED | `b18-member-settings.test.ts`; smoke |
| Search | Client validation, stale-response handling, empty/error states | VERIFIED | `smoke:ui` 42/42; manual reading of `SearchClient` |
| Admin | User/member search & status filters, id/profile-ID lookup, membership / open-report filters | VERIFIED | `b18-search.test.ts` (admin section); matrix |
| Admin | Membership plans CRUD (price, duration, entitlements, activate) | VERIFIED | `b18-plans.test.ts`; browser P1 |
| Admin | Communities add/rename/retire | VERIFIED | `b18-communities.test.ts`; browser P2 |
| Admin | Security events feed (`audit.view`), masked identifiers | VERIFIED | `b18-security-events.test.ts`; browser P3 |
| Admin | Payment reconciliation action | VERIFIED against mock gateways; **real PhonePe/Razorpay: REQUIRES EXTERNAL CREDENTIALS** | `b18-reconcile.test.ts` |
| Admin | Platform settings: sign-ups open/closed, search limits | VERIFIED | `b18-search.test.ts`, `b18-otp-policy.test.ts`; browser O* |
| Admin | Maintenance mode, manual-approval toggle | NOT BUILT | `B18_KNOWN_LIMITATIONS.md` |
| Staff Admin | Every admin API enforces role/permission per request; changes take effect on the next request | VERIFIED | `b18-permission-matrix.test.ts` (67 rules); browser T4 |
| Staff Admin | Sessions revoked on role change / disable / password reset | VERIFIED | `b18-escalation.test.ts` |
| Staff Admin | Cannot create/edit Super Admin, change own role/status, grant permissions they lack | VERIFIED | `b18-escalation.test.ts` |
| Staff Admin | Staff on a **custom role** can use the panel | VERIFIED (defect found by the browser check and fixed) | `b18-escalation.test.ts` `[custom-role-me]`; browser T0 |
| Staff Admin | Pages reached by URL show a clear "needs permission" screen | VERIFIED | browser T1–T3 |
| Member | Privacy controls (profile visibility, photo visibility, last-active) | VERIFIED | `b18-member-settings.test.ts`; browser S1–S7 |
| Member | Notification preferences (non-essential channels) | VERIFIED | `b18-member-settings.test.ts`; browser S5. Only e-mail sends are wired today (see limitations) |
| Member | Session list and sign-out of one device | VERIFIED | `b18-member-settings.test.ts`; browser D1–D2 |
| Member | Change e-mail / mobile | NOT BUILT | `B18_KNOWN_LIMITATIONS.md` |
| Integrations | Razorpay, PhonePe, Fast2SMS, SMTP provider, object storage | REQUIRES EXTERNAL CREDENTIALS — local mocks only | `smoke:gateway` 52/52, `smoke:ui-gateway` 35/35 |
| Security | No secrets in export; `.env.example` placeholders only | VERIFIED | secret scan in `B18_FINAL_REPORT.md` |
