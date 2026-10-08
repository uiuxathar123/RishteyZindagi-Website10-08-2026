# RishteyZindagi Backend — Build Status (Phase B8)

**Last updated:** 2026-09-28
**Stack:** unchanged. New migration `0007_b8_membership_payment.sql` (additive columns only, no new tables — all five B8 tables already existed as unused B1 foundation).

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> B5: PASS — FROZEN
> B6: PASS — FROZEN
> B7: PASS — FROZEN
> B8: PASS — FROZEN (323/323 tests passing)
> B9: NOT STARTED
> ```
> Verified independently: `npx tsc --noEmit` clean, `npm run build` succeeds (25 new routes), `npm test` → 323/323 across 31 files (263 pre-existing B1-B7 + 60 new/changed B8). See `BACKEND.md` §52 for the full writeup. This completes the authorized B6→B7→B8 build; B9 has not been started.

## B8 — Membership + Payment Foundation

Implements `membership_plans`/`memberships`/`payment_gateways`/`payments`/`transactions`/`invoices`/`invoice_logs` — all originally created empty in B1 — with only additive columns, no new tables.

- **Gateways**: Razorpay/Cashfree/PayU/PhonePe/Paytm, exactly one active at a time (service-level transactional enforcement, same singleton-invariant style as `matching_weight_configs`). Credentials encrypted at rest (new AES-256-GCM helper, `src/server/lib/crypto.ts`, keyed by a new env var) and never returned in any API response. Provider abstraction structurally mirrors B2's OTP providers exactly (per-gateway class + dev/mock double + one factory), each honestly reporting unconfigured rather than faking success.
- **Membership plans**: 4 tiers (7-day/monthly/3-month/6-month) x 2 currencies (INR/USD, region resolved from the member's own profile country) = 8 seeded rows, using explicit, clearly-documented **placeholder prices** (not researched real-world pricing). "Advanced Search" and "Unlimited Interests" are informational plan-feature-list entries only — not metered/enforced, since no concrete free-tier quota was ever specified (documented as a deliberate interpretation, not an oversight; inventing a number would have been fabrication).
- **Payment flow**: checkout creates a `PENDING` payment via the active gateway; membership only activates after genuine backend-side verification (never a client-supplied success flag) — verify is idempotent (can't double-activate). Pending payments support status-check, admin visibility, and a `payments.review`-gated manual-activation path (reason + admin id + timestamp + gateway reference, fully audit-logged).
- **Membership lifecycle**: auto-renew ON/OFF, manual renewal always available, upgrade (immediate cutover, no proration) always allowed, downgrade blocked while active, and — per the explicit "no refunds after successful payment" rule — `paymentStatusEnum.REFUNDED` stays permanently dormant, no refund endpoint exists.
- **Two enforced, real cross-phase integrations** (both pre-approved, disclosed, additive, individually tested): (1) sending a **new** Interest (B6) now requires an active membership — accepting/rejecting/withdrawing an already-received interest is untouched; (2) a real **Visibility Boost** for 6-month-plan members nudges B5 recommendation scores by a small capped amount, applied strictly after tier classification — proven (via dedicated tests) to never cross the PRIMARY/SECONDARY boundary and never exceed its cap.
- **Invoices**: number format `RZ-YYYYMMDD-HHMMSS-mmm` (guaranteed-unique), rendered in the member's own country's timezone (a small static ISO-code→IANA map), generated once as a PDF (via `pdfkit`, no browser dependency) from a stored, immutable `snapshot` — never recomputed from possibly-changed live data — and stored through the existing local-disk storage abstraction (same one B3 profile photos use). Tax is a single configurable "GST" rate (env-driven, default documented as a placeholder, never presented as researched tax law); non-INR currencies are untaxed. Cancellation (`VOID`, reusing the frozen `invoice_status` enum's existing value — documented mapping, no new enum value) preserves the original invoice number and all financial data; regeneration is admin-only and fully audit-logged via the existing `invoice_logs` table. History is never deleted.

## Frozen-file exceptions (5 disclosed, all additive/non-weakening)

1. `schema.ts` — 8 new columns across 4 existing, previously-empty B1 tables (invoices/membership_plans/payments/transactions). Zero existing column/index/constraint changed.
2. `env.ts` — new encryption-key var, per-gateway credential vars, a configurable GST-rate var — all additive/optional-or-defaulted.
3. `seed.ts` — one new permission (`payments.review`) + 5 gateway rows + 8 plan rows, via the file's own established idempotent-upsert pattern.
4. `interactions.service.ts` (B6) — a single guard added to the send-interest path only, gating it behind active membership; accept/reject/withdraw untouched. Regression-proven.
5. `recommendations.service.ts` (B5) — one small, capped Visibility Boost integration applied after tier is already decided. Regression-proven never to cross tiers or exceed its cap.

Three pre-existing B6/B7 test files needed fixture-only updates as a direct, disclosed consequence of touch #4 (their shared test fixtures now grant/expire a membership where the flow requires one) — zero assertions weakened, removed, or changed in any of them.

## Final authoritative status

```
B1: PASS — FROZEN
B2: PASS — FROZEN
B3: PASS — FROZEN
B4: PASS — FROZEN
B5: PASS — FROZEN
B6: PASS — FROZEN
B7: PASS — FROZEN
B8: PASS — FROZEN
B9: NOT STARTED
```

323/323 tests passing across 31 files. `npx tsc --noEmit` clean. `npm run build` succeeds. Both the dev and test databases carry every migration (`0000` through `0007`). B6, B7, and B8 are each reviewed at freeze time by independent re-verification (not just the implementing pass's own claim) before being marked FROZEN. This is the end of the currently-authorized build — no B9 work has been started.
