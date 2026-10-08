import { sql, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs, matchingWeightConfigs, reportCategories, membershipPlans, memberships, paymentGateways } from "@/server/db/schema";

/** Truncates every table this test suite might have written to, cascading
 * to dependents, and resets identity sequences (harmless here since IDs
 * are app-generated UUIDs, not serials — kept for correctness if that
 * ever changes). Reference/seed tables (admin_roles, permissions,
 * role_permissions) and the otp_configs singleton are deliberately NOT
 * truncated — see resetOtpConfigForTests for the latter.
 *
 * B6 note: `likes`/`interests`/`matches`/`shortlists`/`blocks`/`reports`/
 * `warnings`/`behaviour_events`/`account_suspensions` are NOT listed
 * explicitly below, but are still fully cleared by this call — every one
 * of them has a `users`-referencing FK declared `onDelete: "cascade"` in
 * schema.ts, so `TRUNCATE ... users ... CASCADE` cascades into all of
 * them automatically (verified: Postgres TRUNCATE CASCADE follows every
 * FK-dependent table transitively, regardless of whether it's named in
 * the TRUNCATE statement). `report_categories`/`warning_categories` are
 * reference/seed data (same category as religions/educations/etc. above)
 * and are deliberately not truncated here — see
 * resetReportAndWarningCategoriesForTests below for the one thing about
 * them a test can leave dirty (an admin-disabled category).
 *
 * B8 note: `memberships`/`payments`/`transactions`/`invoices`/
 * `invoice_logs` are likewise NOT listed explicitly below but ARE fully
 * cleared by this call — each has a `users`-referencing FK (`RESTRICT`
 * on plain DELETE, per schema.ts's own comment on why — but Postgres's
 * `TRUNCATE ... CASCADE` follows any FK-dependent table regardless of
 * its `ON DELETE` action, the exact same mechanism already verified for
 * the B6 tables above). `membership_plans`/`payment_gateways` are
 * reference/config data (same category as `report_categories` above,
 * seeded once, never truncated) — see resetPaymentGatewaysForTests below
 * for the one thing about them a test can leave dirty (an admin-changed
 * active gateway / credentials). */
export async function resetTransactionalTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      login_attempts,
      device_sessions,
      otps,
      profiles,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** NOTE: `TRUNCATE ... CASCADE` on admin_users cascades into otp_configs
 * too (it has an FK on `updated_by_admin_id`) and wipes the singleton row
 * entirely — a TRUNCATE-specific hazard (a normal DELETE would be blocked
 * by the FK instead), not a production concern. resetOtpConfigForTests()
 * is written as an upsert specifically so it self-heals from that,
 * regardless of call order. */
export async function resetAdminUsers() {
  await db.execute(sql`TRUNCATE TABLE admin_users RESTART IDENTITY CASCADE`);
}

/**
 * Resets the otp_configs singleton to known-good, test-friendly values —
 * `dev_mode: true` (so OTPs are captured via DevOtpProvider instead of a
 * real, unconfigured SMS/WhatsApp/Email integration — safe here because
 * NODE_ENV=test, never true in production, see providers/dev.provider.ts's
 * own hard guard) and short cooldown/expiry windows so a test can request,
 * resend, and verify a code without waiting on real-world timers. Call
 * this in any test suite that exercises an OTP flow.
 *
 * Implemented as an upsert (INSERT ... ON CONFLICT DO UPDATE), not a plain
 * UPDATE, so it recreates the row if some other reset step (see
 * resetAdminUsers's note above) cascaded it away — the row must always
 * exist afterward regardless of what ran before it.
 */
export async function resetOtpConfigForTests() {
  await db
    .insert(otpConfigs)
    .values({
      id: 1,
      activeMethod: "EMAIL",
      enabled: true,
      otpLength: 6,
      otpExpirySeconds: 300,
      maxVerifyAttempts: 5,
      resendCooldownSeconds: 1,
      maxResendAttempts: 10,
      resendWindowSeconds: 3600,
      devMode: true,
      updatedByAdminId: null,
    })
    .onConflictDoUpdate({
      target: otpConfigs.id,
      set: {
        activeMethod: "EMAIL",
        enabled: true,
        otpLength: 6,
        otpExpirySeconds: 300,
        maxVerifyAttempts: 5,
        resendCooldownSeconds: 1,
        maxResendAttempts: 10,
        resendWindowSeconds: 3600,
        devMode: true,
        updatedByAdminId: null,
      },
    });
}

/**
 * B5 gap-fix: resets the matching_weight_configs singleton to the
 * documented defaults (byte-identical to scoring.ts's
 * DEFAULT_CATEGORY_WEIGHTS). Same reasoning as resetOtpConfigForTests —
 * `resetAdminUsers()`'s `TRUNCATE ... admin_users ... CASCADE` also
 * cascades into matching_weight_configs (it has an FK on
 * updated_by_admin_id) and wipes the singleton row, so this is written
 * as an upsert to self-heal regardless of call order. Call this in any
 * test suite that exercises recommendations or admin weight config.
 */
export async function resetMatchingWeightsForTests() {
  const defaults = {
    ageWeight: 15,
    heightWeight: 10,
    religionWeight: 10,
    communityWeight: 8,
    motherTongueWeight: 8,
    educationWeight: 10,
    professionWeight: 12,
    maritalStatusWeight: 8,
    locationWeight: 7,
    incomeWeight: 12,
    updatedByAdminId: null,
  };
  await db
    .insert(matchingWeightConfigs)
    .values({ id: 1, ...defaults })
    .onConflictDoUpdate({ target: matchingWeightConfigs.id, set: defaults });
}

/**
 * B6: re-activates every seeded report category. `report_categories` is
 * reference/seed data (never truncated by resetTransactionalTables — see
 * its own comment above), but unlike religions/educations/etc. it IS
 * mutable through an admin endpoint (disable a category) — a test that
 * disables one could otherwise leak that state into a later test file
 * sharing the same test database. Call this in `beforeEach` for any test
 * suite that exercises report-category admin management. Upsert-shaped
 * (by unique `name`) so it's safe even if a category doesn't exist yet
 * in a given environment.
 */
export async function resetReportAndWarningCategoriesForTests() {
  await db.update(reportCategories).set({ isActive: true }).where(eq(reportCategories.isActive, false));
}

/**
 * B7: test-only fixture — gives a user a real, ACTIVE `memberships` row
 * so chat tests can exercise the "membership active -> chat allowed" path
 * (see membership-gate.ts / chat.service.ts). There are legitimately zero
 * active memberships anywhere in this system until B8 (Membership +
 * Payment Foundation) ships its purchase flow — `resetTransactionalTables`
 * above already clears `memberships` on every test run (it cascades off
 * `users ... CASCADE` regardless of the column's own `RESTRICT` FK, which
 * only governs plain `DELETE`, not `TRUNCATE`), so this helper inserts a
 * minimal, idempotent-by-code test membership plan (never touching real
 * B8 seed data, since none exists yet) and an ACTIVE row for the given
 * user. Pass `expiresAt` to simulate an expiring/expired membership.
 */
export async function activateMembershipForTests(userId: string, opts?: { expiresAt?: Date | null }): Promise<void> {
  const [existingPlan] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, "B7_TEST_PLAN")).limit(1);
  const plan =
    existingPlan ??
    (
      await db
        .insert(membershipPlans)
        .values({ code: "B7_TEST_PLAN", name: "B7 Test Plan", priceInPaise: 0, durationDays: 30 })
        .returning()
    )[0];
  await db.insert(memberships).values({
    userId,
    planId: plan.id,
    status: "ACTIVE",
    startedAt: new Date(),
    expiresAt: opts?.expiresAt ?? null,
  });
}

/** B7: flips a user's (test-fixture) membership to EXPIRED — used to
 * exercise "existing chat history stays visible, but no new send" once a
 * membership that WAS active no longer is. */
export async function expireMembershipForTests(userId: string): Promise<void> {
  await db.update(memberships).set({ status: "EXPIRED" }).where(eq(memberships.userId, userId));
}

/**
 * B8: re-activates Razorpay and deactivates every other seeded payment
 * gateway, and clears every gateway's `config` jsonb (mode/credentials)
 * — restoring the exact seed-time default (see seed.ts's PAYMENT_GATEWAYS)
 * regardless of what an earlier test in the same run changed (which
 * gateway is active, or what credentials were saved). Call this in
 * `beforeEach` for any test suite that exercises gateway config/
 * activation/checkout, mirroring resetReportAndWarningCategoriesForTests'
 * own "self-healing reference/config data" precedent — `payment_gateways`
 * is never truncated by resetTransactionalTables (see its own updated
 * comment above), so without this, one test file's gateway changes would
 * leak into the next.
 */
export async function resetPaymentGatewaysForTests(): Promise<void> {
  await db.update(paymentGateways).set({ isActive: false, config: null });
  await db.update(paymentGateways).set({ isActive: true }).where(eq(paymentGateways.name, "Razorpay"));
}
