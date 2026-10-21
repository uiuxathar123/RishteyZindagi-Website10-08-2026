/**
 * Personal Matchmaking refunds, through the real Razorpay provider against the local mock gateway (loopback only,
 * the same set-up as tests/pcp-payments.test.ts). A full refund ends the case and its included access, like a
 * membership's full refund; a partial refund changes nothing. Also: an unpaid matchmaking Razorpay order can be
 * reopened (resume) after the member closed the payment window, and paid through the signed confirm path.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER_MODE = "real";
  process.env.RAZORPAY_API_BASE = "http://127.0.0.1:45871";
  process.env.APP_URL = "http://localhost:3000";
});

import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invoices, matchmakingSuggestions } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import { PUT as putCredentials } from "@/app/api/v1/admin/payments/config/[gateway]/credentials/route";
import { PATCH as patchConfig } from "@/app/api/v1/admin/payments/config/route";
import { POST as createRefund } from "@/app/api/v1/admin/payments/[paymentId]/refunds/route";
import { POST as resumeRoute } from "@/app/api/v1/payments/[paymentId]/razorpay/resume/route";
import { POST as confirmRoute } from "@/app/api/v1/payments/[paymentId]/razorpay/confirm/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { resolveReferenceIds, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { startMockRazorpay, type MockRazorpay } from "./helpers/mock-gateways";
import { api, buildCustomer, caseRow, configure, json, paymentRow } from "./helpers/matchmaking";

const RZP = { keyId: "rzp_test_AbCdEf123456", keySecret: "razorpay-key-secret-123", webhookSecret: "razorpay-webhook-secret-1" };
let rzp: MockRazorpay;
let admin: TestAdmin;
let refs: ReferenceIds;

beforeAll(async () => {
  rzp = await startMockRazorpay({ keyId: RZP.keyId, keySecret: RZP.keySecret });
});
afterAll(async () => {
  await rzp?.close();
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  rzp.requests.length = 0;
  rzp.orders.clear();
  rzp.payments.clear();
  rzp.refunds.clear();
  rzp.failNext = null;
  rzp.newRefundStatus = "processed";
  admin = await createAdmin("SUPER_ADMIN");
  const creds = await putCredentials(
    jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { mode: "test", ...RZP }, token: admin.token }),
    { params: { gateway: "razorpay" } }
  );
  expect(creds.status).toBe(200);
  expect((await patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: "RAZORPAY" }, token: admin.token }))).status).toBe(200);
  await configure(admin.token);
  refs = await resolveReferenceIds();
});

async function paidCase(label: string) {
  const c = await buildCustomer(label, refs);
  const co = await json(await api.checkout(c.member.sessionToken));
  expect(co.status, JSON.stringify(co.body)).toBe(201);
  const { caseId, paymentId, gatewayCheckout } = co.body.data.checkout;
  rzp.capture(gatewayCheckout.orderId);
  expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("SUCCESS");
  return { c, caseId, paymentId };
}

const refund = (paymentId: string, body: unknown) =>
  createRefund(jreq(`http://localhost/api/v1/admin/payments/${paymentId}/refunds`, { body, token: admin.token }), { params: { paymentId } });

describe("Personal Matchmaking refunds", () => {
  it("[mm-refund-full] a full refund marks the case REFUNDED, ends its included access, voids the invoice and withdraws unsent suggestions", async () => {
    const { c, caseId, paymentId } = await paidCase("mm-refund-full");
    expect(await hasActiveMembership(c.member.userId)).toBe(true);
    // an unsent suggestion that the refund must withdraw
    const candidate = await buildCustomer("mm-refund-candidate", refs, "FEMALE");
    const added = await json(await api.admin.addSuggestion(admin.token, caseId, candidate.member.userId));
    expect(added.status, JSON.stringify(added.body)).toBe(201);

    const res = await refund(paymentId, { reason: "customer asked for a full refund" });
    expect(res.status).toBe(201);
    expect((await paymentRow(paymentId)).status).toBe("REFUNDED");
    const row = await caseRow(caseId);
    expect(row.status).toBe("REFUNDED");
    expect(row.includedAccessRevokedAt).not.toBeNull();
    expect(row.closedAt).not.toBeNull();
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
    const [inv] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId));
    expect(inv.status).toBe("VOID");
    const [s] = await db.select().from(matchmakingSuggestions).where(eq(matchmakingSuggestions.id, added.body.data.suggestion.id));
    expect(s.status).toBe("WITHDRAWN");
    const mine = (await json(await api.mine(c.member.sessionToken))).body.data;
    expect(mine.case).toMatchObject({ status: "REFUNDED", accessRevoked: true });
    expect(mine.history.at(-1)).toMatchObject({ toStatus: "REFUNDED" });
  });

  it("[mm-refund-partial] a partial refund leaves the case and its access unchanged", async () => {
    const { c, caseId, paymentId } = await paidCase("mm-refund-partial");
    const res = await refund(paymentId, { amountInPaise: 100000, reason: "goodwill gesture" });
    expect(res.status).toBe(201);
    expect((await paymentRow(paymentId)).status).toBe("SUCCESS");
    expect(await caseRow(caseId)).toMatchObject({ status: "ACTIVE", includedAccessRevokedAt: null });
    expect(await hasActiveMembership(c.member.userId)).toBe(true);
  });
});

describe("Personal Matchmaking — continue an unpaid Razorpay payment", () => {
  const resume = (token: string, paymentId: string) =>
    resumeRoute(jreq(`http://localhost/api/v1/payments/${paymentId}/razorpay/resume`, { body: {}, token }), { params: { paymentId } });

  it("[mm-resume] after closing the payment window the same order is reopened (no second payment), paid and the case activated", async () => {
    const c = await buildCustomer("mm-resume", refs);
    const co = await json(await api.checkout(c.member.sessionToken));
    expect(co.status, JSON.stringify(co.body)).toBe(201);
    const { caseId, paymentId, gatewayCheckout } = co.body.data.checkout;
    const ordersBefore = rzp.orders.size;

    // the member closed the window; a new checkout is refused while this payment is pending…
    expect((await api.checkout(c.member.sessionToken)).status).toBe(409);
    // …but the same order can be reopened
    const r = await json(await resume(c.member.sessionToken, paymentId));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.gatewayCheckout).toEqual({ provider: "RAZORPAY", keyId: RZP.keyId, orderId: gatewayCheckout.orderId, amount: 499900, currency: "INR" });
    expect(rzp.orders.size).toBe(ordersBefore);
    expect((await paymentRow(paymentId)).status).toBe("PENDING");
    expect((await caseRow(caseId)).status).toBe("PENDING_PAYMENT");

    const payId = rzp.capture(gatewayCheckout.orderId);
    const sig = createHmac("sha256", RZP.keySecret).update(`${gatewayCheckout.orderId}|${payId}`).digest("hex");
    const confirmed = await confirmRoute(
      jreq(`http://localhost/api/v1/payments/${paymentId}/razorpay/confirm`, {
        body: { razorpay_payment_id: payId, razorpay_order_id: gatewayCheckout.orderId, razorpay_signature: sig },
        token: c.member.sessionToken,
      }),
      { params: { paymentId } }
    );
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data.status).toBe("SUCCESS");
    expect(await caseRow(caseId)).toMatchObject({ status: "ACTIVE", paidPaymentId: paymentId });
    expect(await hasActiveMembership(c.member.userId)).toBe(true);
    // a paid payment can no longer be reopened
    expect((await resume(c.member.sessionToken, paymentId)).status).toBe(409);
  });
});
