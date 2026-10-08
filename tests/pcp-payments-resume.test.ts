/**
 * Production Completion Phase — reopening an unpaid Razorpay checkout (POST /payments/:id/razorpay/resume).
 * Real Razorpay adapter against the local protocol mock (REQUIRES EXTERNAL CREDENTIALS for the live vendor).
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER_MODE = "real";
  process.env.RAZORPAY_API_BASE = "http://127.0.0.1:45871";
  process.env.PHONEPE_API_BASE = "http://127.0.0.1:45872/pg";
  process.env.PHONEPE_AUTH_BASE = "http://127.0.0.1:45872/identity/v1/oauth/token";
  process.env.APP_URL = "http://localhost:3000";
});

import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, payments } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearPhonePeTokenCacheForTests } from "@/server/modules/payments/providers/phonepe.provider";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { startMockPhonePe, startMockRazorpay, type MockPhonePe, type MockRazorpay } from "./helpers/mock-gateways";

import { PATCH as patchConfig } from "@/app/api/v1/admin/payments/config/route";
import { PUT as putCredentials } from "@/app/api/v1/admin/payments/config/[gateway]/credentials/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as resume } from "@/app/api/v1/payments/[paymentId]/razorpay/resume/route";
import { POST as confirmRazorpay } from "@/app/api/v1/payments/[paymentId]/razorpay/confirm/route";

const RZP = { keyId: "rzp_test_AbCdEf123456", keySecret: "razorpay-key-secret-123", webhookSecret: "razorpay-webhook-secret-1" };
const PP = { clientId: "TESTCLIENT01", clientSecret: "phonepe-client-secret-123", clientVersion: "1", webhookUsername: "ppuser", webhookPassword: "pppass12345" };

let rzp: MockRazorpay;
let pp: MockPhonePe;
let admin: TestAdmin;

beforeAll(async () => {
  rzp = await startMockRazorpay({ keyId: RZP.keyId, keySecret: RZP.keySecret });
  pp = await startMockPhonePe({ clientId: PP.clientId, clientSecret: PP.clientSecret, clientVersion: PP.clientVersion });
});
afterAll(async () => {
  await rzp?.close();
  await pp?.close();
});

const ctxParams = (v: string) => ({ params: { paymentId: v } });
const gwParams = (v: string) => ({ params: { gateway: v } });

async function saveCreds() {
  expect((await putCredentials(jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { mode: "test", ...RZP }, token: admin.token }), gwParams("razorpay"))).status).toBe(200);
  expect((await putCredentials(jreq("http://localhost/api/v1/admin/payments/config/phonepe/credentials", { method: "PUT", body: { mode: "test", ...PP }, token: admin.token }), gwParams("phonepe"))).status).toBe(200);
}
const activate = (key: "RAZORPAY" | "PHONEPE") => patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: key }, token: admin.token }));
const doResume = (token: string | undefined, id: string) => resume(jreq(`http://localhost/api/v1/payments/${id}/razorpay/resume`, { body: {}, token }), ctxParams(id));

async function pending(label: string, gateway: "RAZORPAY" | "PHONEPE" = "RAZORPAY") {
  await activate(gateway);
  const member = await createVerifiedMember(label);
  const res = await checkout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_7DAY_INR" }, token: member.sessionToken }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { member, paymentId: body.data.paymentId as string, body };
}

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __clearPhonePeTokenCacheForTests();
  rzp.requests.length = 0;
  rzp.orders.clear();
  rzp.payments.clear();
  rzp.refunds.clear();
  rzp.failNext = null;
  pp.requests.length = 0;
  pp.orders.clear();
  pp.refunds.clear();
  admin = await createAdmin("SUPER_ADMIN");
  await saveCreds();
});

describe("reopening an unpaid Razorpay checkout", () => {
  it("[resume-same-order] the owner gets the SAME order back with public values and the stored amount; nothing new is created and no secret leaks", async () => {
    const p = await pending("rs-ok");
    const orderCountBefore = rzp.orders.size;
    const res = await doResume(p.member.sessionToken, p.paymentId);
    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text).data;
    expect(data.gatewayCheckout).toEqual({ provider: "RAZORPAY", keyId: RZP.keyId, orderId: p.body.data.gatewayCheckout.orderId, amount: p.body.data.amountInPaise, currency: "INR" });
    expect(rzp.orders.size).toBe(orderCountBefore); // no second order at the gateway
    expect(text).not.toContain(RZP.keySecret);
    expect(text).not.toContain(RZP.webhookSecret);
    const [row] = await db.select().from(payments).where(eq(payments.id, p.paymentId));
    expect(row.status).toBe("PENDING"); // resuming never settles anything
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.checkout_resumed"));
    expect(logs.length).toBe(1);
  });

  it("[resume-then-pay] a resumed order can be paid and is activated only through the signed confirm path", async () => {
    const p = await pending("rs-pay");
    const resumed = (await (await doResume(p.member.sessionToken, p.paymentId)).json()).data.gatewayCheckout;
    const payId = rzp.capture(resumed.orderId);
    const sig = createHmac("sha256", RZP.keySecret).update(`${resumed.orderId}|${payId}`).digest("hex");
    const res = await confirmRazorpay(
      jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, { body: { razorpay_payment_id: payId, razorpay_order_id: resumed.orderId, razorpay_signature: sig }, token: p.member.sessionToken }),
      ctxParams(p.paymentId)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("SUCCESS");
    // once paid it can no longer be resumed
    expect((await doResume(p.member.sessionToken, p.paymentId)).status).toBe(409);
  });

  it("[resume-authz] anonymous 401; another member 403 (IDOR); admin token 401/403; malformed id 400", async () => {
    const p = await pending("rs-authz");
    expect((await doResume(undefined, p.paymentId)).status).toBe(401);
    const other = await createVerifiedMember("rs-other");
    const idor = await doResume(other.sessionToken, p.paymentId);
    expect(idor.status).toBe(403);
    expect(JSON.stringify(await idor.json())).not.toContain(p.body.data.gatewayCheckout.orderId);
    expect([401, 403]).toContain((await doResume(admin.token, p.paymentId)).status);
    expect((await doResume(p.member.sessionToken, "not-a-uuid")).status).toBe(400);
    expect((await doResume(p.member.sessionToken, "00000000-0000-4000-8000-000000000000")).status).toBe(403);
  });

  it("[resume-not-razorpay] a PhonePe payment cannot be reopened through this route (409, explanatory)", async () => {
    const p = await pending("rs-pp", "PHONEPE");
    const res = await doResume(p.member.sessionToken, p.paymentId);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/not started with Razorpay/i);
  });

  it("[resume-expired-and-closed] an expired or already-closed payment is refused", async () => {
    const expired = await pending("rs-exp");
    await db.update(payments).set({ createdAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(payments.id, expired.paymentId));
    const r1 = await doResume(expired.member.sessionToken, expired.paymentId);
    expect(r1.status).toBe(409);
    expect((await r1.json()).error.message).toMatch(/expired/i);

    const failed = await pending("rs-failed");
    await db.update(payments).set({ status: "FAILED" }).where(eq(payments.id, failed.paymentId));
    expect((await doResume(failed.member.sessionToken, failed.paymentId)).status).toBe(409);
  });

  it("[resume-no-credentials] if Razorpay credentials are gone the member gets an honest 503, not a broken popup", async () => {
    const p = await pending("rs-nocreds");
    const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
    // remove the admin-saved credentials
    const { paymentGateways } = await import("@/server/db/schema");
    await db.update(paymentGateways).set({ config: {} }).where(eq(paymentGateways.name, "Razorpay"));
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const res = await doResume(p.member.sessionToken, p.paymentId);
    expect(res.status).toBe(503);
    if (saved.id) process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret) process.env.RAZORPAY_KEY_SECRET = saved.secret;
  });
});

describe("checkout when the gateway cannot create an order", () => {
  it("[checkout-failure-cleanup] no credentials → 503, no PENDING rows left, and an immediate retry is NOT blocked by the duplicate guard", async () => {
    const { paymentGateways, payments: paymentsT, memberships } = await import("@/server/db/schema");
    await activate("RAZORPAY");
    await db.update(paymentGateways).set({ config: {} }).where(eq(paymentGateways.name, "Razorpay"));
    const keep = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const member = await createVerifiedMember("co-fail");
    const go = () => checkout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_7DAY_INR" }, token: member.sessionToken }));
    try {
      const first = await go();
      expect(first.status).toBe(503);
      const pend = await db.select().from(paymentsT).where(eq(paymentsT.userId, member.userId));
      expect(pend.length).toBe(1);
      expect(pend[0].status).toBe("FAILED");
      const mem = await db.select().from(memberships).where(eq(memberships.userId, member.userId));
      expect(mem.every((m) => m.status !== "PENDING")).toBe(true);
      // retry is answered by the gateway problem again — not "already pending"
      const second = await go();
      expect(second.status).toBe(503);
    } finally {
      if (keep.id) process.env.RAZORPAY_KEY_ID = keep.id;
      if (keep.secret) process.env.RAZORPAY_KEY_SECRET = keep.secret;
    }
    // credentials restored → the very next attempt succeeds
    await saveCreds();
    const ok = await go();
    expect(ok.status).toBe(200);
  });
});
