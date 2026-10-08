/**
 * B8: member-facing membership lifecycle — expiry (request-time
 * computed), manual renewal, auto-renew (success/failure paths +
 * reminder eligibility), auto-renew OFF (expires cleanly), upgrade (old
 * cancelled, new active, no proration), downgrade blocked while active,
 * a no-refund meta-test (REFUNDED is never set anywhere in this phase),
 * and cancellation semantics (autoRenew=false only, current period
 * untouched).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { GET as getMyMembership } from "@/app/api/v1/memberships/me/route";
import { GET as listMyMembershipHistory } from "@/app/api/v1/memberships/me/history/route";
import { POST as cancelAutoRenew } from "@/app/api/v1/memberships/me/[membershipId]/cancel-auto-renew/route";
import { POST as enableAutoRenew } from "@/app/api/v1/memberships/me/[membershipId]/enable-auto-renew/route";
import { POST as renewMembership } from "@/app/api/v1/memberships/me/renew/route";
import { POST as autoRenewAttempt } from "@/app/api/v1/memberships/me/auto-renew-attempt/route";
import { POST as renewalReminderCheck } from "@/app/api/v1/memberships/me/renewal-reminder-check/route";
import { db } from "@/server/db/client";
import { memberships, payments } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { req, createVerifiedMember } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

async function purchaseAndActivate(token: string, planCode: string, opts?: { autoRenew?: boolean }) {
  const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode, ...opts, devSimulateOutcome: "SUCCESS" }, token));
  const { data: checkoutData } = await checkoutRes.json();
  const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, token), {
    params: { paymentId: checkoutData.paymentId },
  });
  const { data: verifyData } = await verifyRes.json();
  expect(verifyData.status).toBe("SUCCESS");
  return checkoutData.membershipId as string;
}

/** Directly backdates a membership's expiresAt (and, optionally, flips
 * status) so tests can exercise "already expired" without waiting on
 * real time — same direct-table-write posture tests/behaviour-events.test.ts
 * uses for its own tier-boundary fixtures. */
async function backdateMembership(membershipId: string, opts: { expiresAt: Date; status?: "ACTIVE" | "EXPIRED" }) {
  await db
    .update(memberships)
    .set({ expiresAt: opts.expiresAt, ...(opts.status ? { status: opts.status } : {}) })
    .where(eq(memberships.id, membershipId));
}

describe("B8 memberships (lifecycle)", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
  });

  it("[mem-expiry-request-time] a membership whose expiresAt has passed reads back as EXPIRED even though nothing wrote to it", async () => {
    const member = await createVerifiedMember("mem-expiry");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    // Backdate expiresAt only — status stays ACTIVE in the DB, exactly
    // modeling "time passed, nothing has re-written this row yet".
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000) });

    const res = await getMyMembership(greq("http://localhost/api/v1/memberships/me", member.sessionToken));
    const { data } = await res.json();
    expect(data.isActive).toBe(false);
    expect(data.membership.status).toBe("EXPIRED");
  });

  it("[mem-manual-renewal] manual renewal is always available and creates a fresh checkout for the same plan", async () => {
    const member = await createVerifiedMember("mem-renew");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" });

    const res = await renewMembership(preq("http://localhost/api/v1/memberships/me/renew", { devSimulateOutcome: "SUCCESS" }, member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("PENDING"); // renew() only creates the checkout; caller verifies separately
    expect(data.membershipId).not.toBe(membershipId);
  });

  it("[mem-auto-renew-off-expires-cleanly] with auto-renew off, an expired membership just stays expired — no automatic renewal happens", async () => {
    const member = await createVerifiedMember("mem-no-autorenew");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR", { autoRenew: false });
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" });

    const res = await autoRenewAttempt(preq("http://localhost/api/v1/memberships/me/auto-renew-attempt", {}, member.sessionToken));
    const { data } = await res.json();
    expect(data.renewed).toBe(false);
    expect(data.reason).toMatch(/auto-renew is not enabled/i);

    const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
    expect(row.status).toBe("EXPIRED");
  });

  it("[mem-auto-renew-success] with auto-renew on and the membership expired, a successful auto-renew attempt activates a new membership", async () => {
    const member = await createVerifiedMember("mem-autorenew-ok");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR", { autoRenew: true });
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" });

    const res = await autoRenewAttempt(
      preq("http://localhost/api/v1/memberships/me/auto-renew-attempt", { devSimulateOutcome: "SUCCESS" }, member.sessionToken)
    );
    const { data } = await res.json();
    expect(data.renewed).toBe(true);

    const history = await listMyMembershipHistory(greq("http://localhost/api/v1/memberships/me/history", member.sessionToken));
    const { data: historyData } = await history.json();
    expect(historyData.memberships.length).toBe(2);
    const newest = historyData.memberships.find((m: { id: string }) => m.id !== membershipId);
    expect(newest.status).toBe("ACTIVE");
    expect(newest.autoRenew).toBe(true); // carried forward onto the new row
  });

  it("[mem-auto-renew-failure] with auto-renew on but the gateway declining, the old membership stays EXPIRED (never resurrected)", async () => {
    const member = await createVerifiedMember("mem-autorenew-fail");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR", { autoRenew: true });
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" });

    const res = await autoRenewAttempt(
      preq("http://localhost/api/v1/memberships/me/auto-renew-attempt", { devSimulateOutcome: "FAILED" }, member.sessionToken)
    );
    const { data } = await res.json();
    expect(data.renewed).toBe(false);

    const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
    expect(row.status).toBe("EXPIRED");
  });

  it("[mem-auto-renew-not-yet-expired] auto-renew attempt is a no-op while the membership is still active", async () => {
    const member = await createVerifiedMember("mem-autorenew-early");
    await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR", { autoRenew: true });

    const res = await autoRenewAttempt(
      preq("http://localhost/api/v1/memberships/me/auto-renew-attempt", { devSimulateOutcome: "SUCCESS" }, member.sessionToken)
    );
    const { data } = await res.json();
    expect(data.renewed).toBe(false);
    expect(data.reason).toMatch(/not currently expired/i);
  });

  it("[mem-renewal-reminder-eligible] a membership expiring within the reminder window is eligible for a reminder; one far in the future is not", async () => {
    const soon = await createVerifiedMember("mem-reminder-soon");
    const soonMembershipId = await purchaseAndActivate(soon.sessionToken, "PLAN_MONTHLY_INR");
    await backdateMembership(soonMembershipId, { expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }); // 2 days out, within the 3-day window

    const soonRes = await renewalReminderCheck(preq("http://localhost/api/v1/memberships/me/renewal-reminder-check", {}, soon.sessionToken));
    const { data: soonData } = await soonRes.json();
    expect(soonData.sent).toBe(true);

    const far = await createVerifiedMember("mem-reminder-far");
    await purchaseAndActivate(far.sessionToken, "PLAN_MONTHLY_INR"); // fresh 30-day membership, well outside the window

    const farRes = await renewalReminderCheck(preq("http://localhost/api/v1/memberships/me/renewal-reminder-check", {}, far.sessionToken));
    const { data: farData } = await farRes.json();
    expect(farData.sent).toBe(false);
  });

  it("[mem-upgrade] upgrading to a higher tier cancels the old membership and activates the new one with a fresh (non-prorated) full term", async () => {
    const member = await createVerifiedMember("mem-upgrade");
    const oldMembershipId = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const newMembershipId = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR");

    const [oldRow] = await db.select().from(memberships).where(eq(memberships.id, oldMembershipId));
    const [newRow] = await db.select().from(memberships).where(eq(memberships.id, newMembershipId));
    expect(oldRow.status).toBe("CANCELLED");
    expect(newRow.status).toBe("ACTIVE");
    // Fresh, full 30-day term from activation time — no proration/carry-over
    // of the old plan's remaining days.
    const durationMs = newRow.expiresAt!.getTime() - newRow.startedAt!.getTime();
    expect(Math.round(durationMs / (24 * 60 * 60 * 1000))).toBe(30);
  });

  it("[mem-downgrade-blocked] switching to a lower tier while the current membership is active is rejected at checkout", async () => {
    const member = await createVerifiedMember("mem-downgrade");
    await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR");

    const res = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
    expect(res.status).toBe(409);
  });

  it("[mem-downgrade-allowed-after-expiry] the same lower-tier switch is allowed once the current membership has expired", async () => {
    const member = await createVerifiedMember("mem-downgrade-after");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR");
    await backdateMembership(membershipId, { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" });

    const res = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
    expect(res.status).toBe(200);
  });

  it("[mem-cancel-auto-renew] cancellation turns off auto-renew only — the current membership stays ACTIVE with its expiresAt untouched", async () => {
    const member = await createVerifiedMember("mem-cancel");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR", { autoRenew: true });
    const [before] = await db.select().from(memberships).where(eq(memberships.id, membershipId));

    const res = await cancelAutoRenew(preq(`http://localhost/api/v1/memberships/me/${membershipId}/cancel-auto-renew`, {}, member.sessionToken), {
      params: { membershipId },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.membership.autoRenew).toBe(false);
    expect(data.membership.status).toBe("ACTIVE");
    expect(data.membership.expiresAt).toBe(before.expiresAt!.toISOString());
  });

  it("[mem-enable-auto-renew] a member can turn auto-renew back on", async () => {
    const member = await createVerifiedMember("mem-enable-autorenew");
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR", { autoRenew: false });

    const res = await enableAutoRenew(preq(`http://localhost/api/v1/memberships/me/${membershipId}/enable-auto-renew`, {}, member.sessionToken), {
      params: { membershipId },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.membership.autoRenew).toBe(true);
  });

  it("[mem-cancel-auto-renew-idor] a member cannot cancel auto-renew on another member's membership", async () => {
    const owner = await createVerifiedMember("mem-cancel-idor-owner");
    const intruder = await createVerifiedMember("mem-cancel-idor-intruder");
    const membershipId = await purchaseAndActivate(owner.sessionToken, "PLAN_MONTHLY_INR", { autoRenew: true });

    const res = await cancelAutoRenew(preq(`http://localhost/api/v1/memberships/me/${membershipId}/cancel-auto-renew`, {}, intruder.sessionToken), {
      params: { membershipId },
    });
    expect(res.status).toBe(403);
  });

  it("[mem-no-refund-ever] REFUNDED is never set on any payment anywhere in this phase (no refund flow exists)", async () => {
    const member = await createVerifiedMember("mem-no-refund");
    await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR", { autoRenew: true });
    const membershipId = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR"); // upgrade -> cancels the old one
    void membershipId;

    const rows = await db.select().from(payments);
    expect(rows.every((p) => p.status !== "REFUNDED")).toBe(true);
  });
});
