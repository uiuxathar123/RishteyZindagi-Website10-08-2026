/**
 * D-6: a membership payment whose SUCCESS was committed but whose fulfilment (activation and/or invoice) was
 * interrupted is completed by a replay (member verify, admin manual verify) and by the payment-reconcile job —
 * exactly once, also under concurrent replays. Dev/mock gateway only.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invoiceLogs, invoices, memberships, notifications } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import * as paymentsRepo from "@/server/modules/payments/payments.repository";
import { paymentReconcileJob } from "@/server/jobs/definitions/payments";
import { POST as membershipCheckout } from "@/app/api/v1/memberships/checkout/route";
import { POST as manualActivate } from "@/app/api/v1/admin/payments/[paymentId]/manual-activate/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { resolveReferenceIds, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { api, buildCustomer, json } from "./helpers/matchmaking";

let refs: ReferenceIds;
let superAdmin: TestAdmin;

const invoiceCount = async (paymentId: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.paymentId, paymentId)))[0].n;
const activatedNotices = async (membershipId: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.dedupeKey, `membership_activated:${membershipId}`)))[0].n;
const membershipRow = async (id: string) => (await db.select().from(memberships).where(eq(memberships.id, id)))[0];

async function checkoutMembership(token: string, planCode = "PLAN_MONTHLY_INR") {
  const res = await membershipCheckout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode }, token }));
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return { paymentId: body.data.paymentId as string, membershipId: body.data.membershipId as string };
}

/** Simulates a crash right after the payment's SUCCESS was committed, before any fulfilment ran. */
async function interruptedPurchase(prefix: string) {
  const c = await buildCustomer(prefix, refs);
  const { paymentId, membershipId } = await checkoutMembership(c.member.sessionToken);
  await paymentsRepo.resolvePaymentOutcome(paymentId, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
  expect((await membershipRow(membershipId)).status).toBe("PENDING");
  expect(await hasActiveMembership(c.member.userId)).toBe(false);
  return { c, paymentId, membershipId };
}

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __clearDevPaymentStoreForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  superAdmin = await createAdmin("SUPER_ADMIN");
});

describe("D-6: interrupted membership fulfilment is repaired", () => {
  it("[d6-interrupted] a SUCCESS payment with a PENDING membership is activated once by a member replay, a manual verify, or the reconcile job", async () => {
    for (const via of ["replay", "manual", "job"] as const) {
      const { c, paymentId, membershipId } = await interruptedPurchase(`d6-int-${via}`);
      if (via === "replay") {
        expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("ALREADY_RESOLVED");
      } else if (via === "manual") {
        const res = await manualActivate(jreq(`http://localhost/api/v1/admin/payments/${paymentId}/manual-activate`, { body: { reason: "repair check" }, token: superAdmin.token }), { params: { paymentId } });
        expect((await res.json()).data.status).toBe("ALREADY_RESOLVED");
      } else {
        const stats = (await paymentReconcileJob.run()) as Record<string, number>;
        expect(stats.membershipFulfilled, via).toBe(1);
      }
      const m = await membershipRow(membershipId);
      expect(m.status, via).toBe("ACTIVE");
      expect(m.expiresAt!.getTime() - m.startedAt!.getTime(), via).toBe(30 * 24 * 60 * 60 * 1000);
      expect(await hasActiveMembership(c.member.userId), via).toBe(true);
      expect(await invoiceCount(paymentId), via).toBe(1);
      expect(await activatedNotices(membershipId), via).toBe(1);

      // further replays and job runs change nothing
      const startedAt = m.startedAt!.getTime();
      expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("ALREADY_RESOLVED");
      await paymentReconcileJob.run();
      expect((await membershipRow(membershipId)).startedAt!.getTime(), via).toBe(startedAt);
      expect(await invoiceCount(paymentId), via).toBe(1);
      expect(await activatedNotices(membershipId), via).toBe(1);
    }
  });

  it("[d6-concurrent] five simultaneous replays of an interrupted payment: one activation, one invoice, one notification", async () => {
    const { c, paymentId, membershipId } = await interruptedPurchase("d6-race");
    const results = await Promise.all(Array.from({ length: 5 }, () => api.verify(c.member.sessionToken, paymentId).then(json)));
    expect(results.every((r) => r.body.data.status === "ALREADY_RESOLVED")).toBe(true);
    expect((await membershipRow(membershipId)).status).toBe("ACTIVE");
    expect(await invoiceCount(paymentId)).toBe(1);
    expect(await activatedNotices(membershipId)).toBe(1);
  });

  it("[d6-invoice-missing] an activated membership whose invoice was never issued gets exactly one invoice from the job", async () => {
    const c = await buildCustomer("d6-noinv", refs);
    const { paymentId, membershipId } = await checkoutMembership(c.member.sessionToken);
    expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("SUCCESS");
    const before = await membershipRow(membershipId);
    // simulate the invoice step failing after activation
    const [inv] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId));
    await db.delete(invoiceLogs).where(eq(invoiceLogs.invoiceId, inv.id));
    await db.delete(invoices).where(eq(invoices.id, inv.id));
    expect(await invoiceCount(paymentId)).toBe(0);

    const stats = (await paymentReconcileJob.run()) as Record<string, number>;
    expect(stats.membershipFulfilled).toBe(1);
    expect(await invoiceCount(paymentId)).toBe(1);
    await paymentReconcileJob.run();
    expect(await invoiceCount(paymentId)).toBe(1);
    const after = await membershipRow(membershipId);
    expect(after.startedAt).toEqual(before.startedAt);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(await activatedNotices(membershipId)).toBe(1);
  });

  it("[d6-upgrade] repairing an interrupted upgrade cancels the previous ACTIVE membership", async () => {
    const c = await buildCustomer("d6-upgrade", refs);
    const first = await checkoutMembership(c.member.sessionToken, "PLAN_MONTHLY_INR");
    expect((await json(await api.verify(c.member.sessionToken, first.paymentId))).body.data.status).toBe("SUCCESS");
    const second = await checkoutMembership(c.member.sessionToken, "PLAN_3MONTH_INR");
    await paymentsRepo.resolvePaymentOutcome(second.paymentId, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
    await paymentReconcileJob.run();
    expect((await membershipRow(first.membershipId)).status).toBe("CANCELLED");
    expect((await membershipRow(second.membershipId)).status).toBe("ACTIVE");
    expect(await invoiceCount(second.paymentId)).toBe(1);
  });

  it("[d6-not-started] a SUCCESS payment whose membership was closed without starting is never activated and is flagged once", async () => {
    const { c, paymentId, membershipId } = await interruptedPurchase("d6-closed");
    await db.update(memberships).set({ status: "CANCELLED" }).where(eq(memberships.id, membershipId));
    await paymentReconcileJob.run();
    await paymentReconcileJob.run();
    expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("ALREADY_RESOLVED");
    expect((await membershipRow(membershipId)).status).toBe("CANCELLED");
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
    expect(await invoiceCount(paymentId)).toBe(0);
    const flags = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "payment.success_membership_not_started"), eq(auditLogs.entityId, paymentId)));
    expect(flags).toHaveLength(1);
  });
});
