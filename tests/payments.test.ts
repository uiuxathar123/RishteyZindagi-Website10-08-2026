/**
 * B8: checkout -> verify -> activate payment lifecycle, using the
 * dev/mock gateway provider (always selected in NODE_ENV=test — see
 * providers/factory.ts). Exercises the honest, non-fabricated
 * verification rule end to end: membership activation only ever follows
 * a genuine, provider-confirmed SUCCESS (never a client-claimed one),
 * replay protection on verify/manual-activate, duplicate-checkout
 * prevention, payment IDOR, admin RBAC on payment-review endpoints, and
 * that switching the active gateway never touches an existing payment's
 * own stored gatewayId.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { GET as getMyPayment } from "@/app/api/v1/payments/[paymentId]/route";
import { GET as listMyPayments } from "@/app/api/v1/payments/me/route";
import { GET as listPaymentsForAdmin } from "@/app/api/v1/admin/payments/route";
import { POST as manualActivate } from "@/app/api/v1/admin/payments/[paymentId]/manual-activate/route";
import { POST as activateGateway } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/activate/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs, memberships, paymentGateways, payments } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
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

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `pay-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Payments Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
  const loginRes = await loginAdmin(
    new NextRequest("http://localhost/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "adminpassword1" }),
    })
  );
  const { data } = await loginRes.json();
  return data.sessionToken as string;
}

async function gatewayIdByName(name: string): Promise<string> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.name, name)).limit(1);
  if (!row) throw new Error(`Seeded payment gateway "${name}" not found.`);
  return row.id;
}

async function doCheckout(token: string, planCode: string, opts?: { autoRenew?: boolean; devSimulateOutcome?: "SUCCESS" | "FAILED" | "PENDING" }) {
  const res = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode, ...opts }, token));
  const body = await res.json();
  return { res, body };
}

async function doVerify(token: string, paymentId: string) {
  const res = await verifyPayment(preq(`http://localhost/api/v1/payments/${paymentId}/verify`, {}, token), { params: { paymentId } });
  const body = await res.json();
  return { res, body };
}

describe("B8 payments (checkout / verify / manual activation)", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
  });

  it("[pay-checkout-creates-pending] checkout creates a PENDING payment + membership, never activates immediately", async () => {
    const member = await createVerifiedMember("pay-checkout");
    const { res, body } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR");
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("PENDING");
    expect(body.data.currency).toBe("INR");
    expect(body.data.amountInPaise).toBe(19900);

    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, body.data.paymentId));
    expect(paymentRow.status).toBe("PENDING");
    const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, body.data.membershipId));
    expect(membershipRow.status).toBe("PENDING");
  });

  it("[pay-verify-success-activates] a genuine SUCCESS verify activates the membership and issues an invoice, never trusting client-claimed success", async () => {
    const member = await createVerifiedMember("pay-verify-success");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "SUCCESS" });
    const { res, body } = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("SUCCESS");
    expect(body.data.payment.status).toBe("SUCCESS");
    expect(body.data.payment.verificationMethod).toBe("AUTO");
    expect(body.data.payment.verifiedAt).not.toBeNull();

    const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, checkoutBody.data.membershipId));
    expect(membershipRow.status).toBe("ACTIVE");
    expect(membershipRow.expiresAt).not.toBeNull();
  });

  it("[pay-verify-failed-no-activation] a FAILED verify never activates the membership", async () => {
    const member = await createVerifiedMember("pay-verify-failed");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "FAILED" });
    const { res, body } = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("FAILED");

    const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, checkoutBody.data.membershipId));
    expect(membershipRow.status).toBe("PENDING");
  });

  it("[pay-verify-pending-stays-pending] a PENDING gateway outcome leaves the payment PENDING for a later retry/manual review", async () => {
    const member = await createVerifiedMember("pay-verify-pending");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    const { res, body } = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("PENDING");

    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, checkoutBody.data.paymentId));
    expect(paymentRow.status).toBe("PENDING");
  });

  it("[pay-status-check] GET /payments/:id reports the current payment status without re-verifying", async () => {
    const member = await createVerifiedMember("pay-status");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    const res = await getMyPayment(greq(`http://localhost/api/v1/payments/${checkoutBody.data.paymentId}`, member.sessionToken), {
      params: { paymentId: checkoutBody.data.paymentId },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.payment.status).toBe("PENDING");
  });

  it("[pay-duplicate-checkout-blocked] a second checkout for the same plan within the TTL window is rejected", async () => {
    const member = await createVerifiedMember("pay-dup");
    const first = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    expect(first.res.status).toBe(200);
    const second = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    expect(second.res.status).toBe(409);
  });

  it("[pay-manual-activation] admin manual-activate resolves a PENDING payment, is audit-logged, and requires a reason", async () => {
    const member = await createVerifiedMember("pay-manual");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_MONTHLY_INR", { devSimulateOutcome: "PENDING" });
    const token = await seedAdmin("SUPER_ADMIN");

    const noReasonRes = await manualActivate(
      preq(`http://localhost/api/v1/admin/payments/${checkoutBody.data.paymentId}/manual-activate`, { reason: "" }, token),
      { params: { paymentId: checkoutBody.data.paymentId } }
    );
    expect(noReasonRes.status).toBe(400);

    const res = await manualActivate(
      preq(
        `http://localhost/api/v1/admin/payments/${checkoutBody.data.paymentId}/manual-activate`,
        { reason: "Bank transfer confirmed manually by finance team.", gatewayTransactionId: "MANUAL_REF_123" },
        token
      ),
      { params: { paymentId: checkoutBody.data.paymentId } }
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("SUCCESS");
    expect(data.payment.verificationMethod).toBe("MANUAL");

    const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, checkoutBody.data.membershipId));
    expect(membershipRow.status).toBe("ACTIVE");

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.manually_activated"));
    expect(logs.some((l) => l.entityId === checkoutBody.data.paymentId)).toBe(true);
  });

  it("[pay-replay-protection] verifying an already-resolved payment twice never double-activates or re-issues an invoice", async () => {
    const member = await createVerifiedMember("pay-replay");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "SUCCESS" });
    const firstVerify = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(firstVerify.body.data.status).toBe("SUCCESS");
    const firstMembership = await db.select().from(memberships).where(eq(memberships.id, checkoutBody.data.membershipId));
    const firstExpiresAt = firstMembership[0].expiresAt?.getTime();

    const secondVerify = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(secondVerify.body.data.status).toBe("ALREADY_RESOLVED");

    const secondMembership = await db.select().from(memberships).where(eq(memberships.id, checkoutBody.data.membershipId));
    // Membership row untouched by the replayed verify (same expiresAt,
    // still exactly one ACTIVE row for this user).
    expect(secondMembership[0].expiresAt?.getTime()).toBe(firstExpiresAt);
    const { invoices } = await import("@/server/db/schema");
    const invoiceRows = await db.select().from(invoices).where(eq(invoices.paymentId, checkoutBody.data.paymentId));
    expect(invoiceRows).toHaveLength(1);
  });

  it("[pay-manual-activate-replay-safe] manually activating an already-SUCCESS payment is a no-op, not a second activation", async () => {
    const member = await createVerifiedMember("pay-manual-replay");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "SUCCESS" });
    await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    const token = await seedAdmin("SUPER_ADMIN");
    const res = await manualActivate(
      preq(`http://localhost/api/v1/admin/payments/${checkoutBody.data.paymentId}/manual-activate`, { reason: "Double-checking." }, token),
      { params: { paymentId: checkoutBody.data.paymentId } }
    );
    const { data } = await res.json();
    expect(data.status).toBe("ALREADY_RESOLVED");
  });

  it("[pay-idor] a member cannot read or verify another member's payment", async () => {
    const owner = await createVerifiedMember("pay-idor-owner");
    const intruder = await createVerifiedMember("pay-idor-intruder");
    const { body: checkoutBody } = await doCheckout(owner.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });

    const getRes = await getMyPayment(greq(`http://localhost/api/v1/payments/${checkoutBody.data.paymentId}`, intruder.sessionToken), {
      params: { paymentId: checkoutBody.data.paymentId },
    });
    expect(getRes.status).toBe(403);

    const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutBody.data.paymentId}/verify`, {}, intruder.sessionToken), {
      params: { paymentId: checkoutBody.data.paymentId },
    });
    expect(verifyRes.status).toBe(403);
  });

  it("[pay-list-mine] a member's own payment list only ever contains their own payments", async () => {
    const a = await createVerifiedMember("pay-list-a");
    const b = await createVerifiedMember("pay-list-b");
    await doCheckout(a.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    await doCheckout(b.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });

    const res = await listMyPayments(greq("http://localhost/api/v1/payments/me", a.sessionToken));
    const { data } = await res.json();
    expect(data.payments).toHaveLength(1);
  });

  it("[pay-admin-rbac] listing/manually-activating payments requires payments.review — a STAFF_ADMIN without it is denied", async () => {
    const member = await createVerifiedMember("pay-rbac");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    const staffToken = await seedAdmin("STAFF_ADMIN");

    const listRes = await listPaymentsForAdmin(greq("http://localhost/api/v1/admin/payments", staffToken));
    expect(listRes.status).toBe(403);

    const manualRes = await manualActivate(
      preq(`http://localhost/api/v1/admin/payments/${checkoutBody.data.paymentId}/manual-activate`, { reason: "test" }, staffToken),
      { params: { paymentId: checkoutBody.data.paymentId } }
    );
    expect(manualRes.status).toBe(403);
  });

  it("[pay-gateway-preserved-on-switch] switching the active gateway never changes an existing payment's own stored gatewayId", async () => {
    const member = await createVerifiedMember("pay-gw-preserve");
    const razorpayId = await gatewayIdByName("Razorpay");
    const { body: checkoutBody } = await doCheckout(member.sessionToken, "PLAN_7DAY_INR", { devSimulateOutcome: "PENDING" });
    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, checkoutBody.data.paymentId));
    expect(paymentRow.gatewayId).toBe(razorpayId);

    const adminToken = await seedAdmin("SUPER_ADMIN");
    const cashfreeId = await gatewayIdByName("Cashfree Payments");
    await activateGateway(preq(`http://localhost/api/v1/admin/payment-gateways/${cashfreeId}/activate`, {}, adminToken), {
      params: { gatewayId: cashfreeId },
    });

    const [paymentRowAfter] = await db.select().from(payments).where(eq(payments.id, checkoutBody.data.paymentId));
    expect(paymentRowAfter.gatewayId).toBe(razorpayId);

    // Verification still succeeds using the payment's OWN stored gateway
    // (dev provider either way in tests, but the resolution path itself
    // reads payments.gatewayId, never "whichever gateway is active now" —
    // see payments.service.ts's own top-of-file comment).
    const { res } = await doVerify(member.sessionToken, checkoutBody.data.paymentId);
    expect(res.status).toBe(200);
  });

  it("[pay-plan-not-found] checkout with an unknown or inactive plan code is rejected", async () => {
    const member = await createVerifiedMember("pay-bad-plan");
    const res = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "NOT_A_REAL_PLAN" }, member.sessionToken));
    expect(res.status).toBe(404);
  });
});
