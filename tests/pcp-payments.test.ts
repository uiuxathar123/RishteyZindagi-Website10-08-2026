/**
 * Production Completion Phase — payments (Razorpay + PhonePe).
 *
 * The REAL provider adapters run here (PAYMENT_PROVIDER_MODE=real) against
 * protocol-accurate local mock servers (tests/helpers/mock-gateways.ts). This
 * verifies request construction, auth headers, response parsing, signature /
 * authorization checks, idempotency, race-safety, refunds and RBAC. It does NOT
 * verify that live Razorpay / PhonePe accept real credentials (that stays
 * REQUIRES EXTERNAL CREDENTIALS).
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
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invoices, memberships, paymentGateways, paymentRefunds, paymentWebhookEvents, payments } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearPhonePeTokenCacheForTests } from "@/server/modules/payments/providers/phonepe.provider";
import { phonepeAuthorizationValue } from "@/server/modules/payments/webhooks.service";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, grantPermission, jreq, resetPcpTables, revokePermission, type TestAdmin } from "./helpers/pcp";
import { startMockPhonePe, startMockRazorpay, type MockPhonePe, type MockRazorpay } from "./helpers/mock-gateways";

import { GET as getConfig, PATCH as patchConfig } from "@/app/api/v1/admin/payments/config/route";
import { PUT as putCredentials } from "@/app/api/v1/admin/payments/config/[gateway]/credentials/route";
import { POST as testConnection } from "@/app/api/v1/admin/payments/config/[gateway]/test-connection/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as confirmRazorpay } from "@/app/api/v1/payments/[paymentId]/razorpay/confirm/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { POST as razorpayWebhook } from "@/app/api/v1/webhooks/razorpay/route";
import { POST as phonepeWebhook } from "@/app/api/v1/webhooks/phonepe/route";
import { GET as listRefunds, POST as createRefund } from "@/app/api/v1/admin/payments/[paymentId]/refunds/route";

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

const ctxParams = (key: string, v: string) => ({ params: { [key]: v } });

async function saveCreds() {
  const r1 = await putCredentials(
    jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { mode: "test", ...RZP }, token: admin.token }),
    ctxParams("gateway", "razorpay")
  );
  expect(r1.status).toBe(200);
  const r2 = await putCredentials(
    jreq("http://localhost/api/v1/admin/payments/config/phonepe/credentials", { method: "PUT", body: { mode: "test", ...PP }, token: admin.token }),
    ctxParams("gateway", "phonepe")
  );
  expect(r2.status).toBe(200);
}

async function activate(key: "RAZORPAY" | "PHONEPE", token = admin.token) {
  return patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: key }, token }));
}

async function startCheckout(token: string, planCode = "PLAN_7DAY_INR") {
  const res = await checkout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode }, token }));
  return { res, body: await res.json() };
}

function rzpSig(raw: string, secret = RZP.webhookSecret) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}
function rzpWebhookReq(payload: unknown, opts: { secret?: string; eventId?: string; sig?: string } = {}) {
  const raw = JSON.stringify(payload);
  return new Request("http://localhost/api/v1/webhooks/razorpay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": opts.sig ?? rzpSig(raw, opts.secret), ...(opts.eventId ? { "x-razorpay-event-id": opts.eventId } : {}) },
    body: raw,
  });
}
function ppWebhookReq(payload: unknown, auth?: string) {
  return new Request("http://localhost/api/v1/webhooks/phonepe", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(payload),
  });
}
const ppAuth = () => phonepeAuthorizationValue(PP.webhookUsername, PP.webhookPassword);

async function paymentRow(id: string) {
  const [p] = await db.select().from(payments).where(eq(payments.id, id));
  return p;
}
async function activeGatewayNames() {
  const rows = await db.select().from(paymentGateways).where(eq(paymentGateways.isActive, true));
  return rows.map((r) => r.name);
}

/** member + Razorpay checkout; returns ids and the mock order id */
async function razorpayPending(label: string) {
  await activate("RAZORPAY");
  const member = await createVerifiedMember(label);
  const { res, body } = await startCheckout(member.sessionToken);
  expect(res.status).toBe(200);
  return { member, paymentId: body.data.paymentId as string, membershipId: body.data.membershipId as string, orderId: body.data.gatewayCheckout.orderId as string, body };
}
async function razorpayPaid(label: string) {
  const p = await razorpayPending(label);
  const payId = rzp.capture(p.orderId);
  const v = await verifyPayment(jreq(`http://localhost/api/v1/payments/${p.paymentId}/verify`, { body: {}, token: p.member.sessionToken }), ctxParams("paymentId", p.paymentId));
  expect(v.status).toBe(200);
  expect((await v.json()).data.status).toBe("SUCCESS");
  return { ...p, gatewayPaymentId: payId };
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
  rzp.newRefundStatus = "pending";
  pp.requests.length = 0;
  pp.orders.clear();
  pp.refunds.clear();
  pp.tokensIssued = 0;
  admin = await createAdmin("SUPER_ADMIN");
  await saveCreds();
});

// ---------------------------------------------------------------------------
describe("admin payment configuration", () => {
  it("[cfg-rbac] anonymous 401, staff without settings permission 403, super admin 200", async () => {
    const anon = await getConfig(jreq("http://localhost/api/v1/admin/payments/config"));
    expect(anon.status).toBe(401);
    const staff = await createAdmin("STAFF_ADMIN");
    const denied = await getConfig(jreq("http://localhost/api/v1/admin/payments/config", { token: staff.token }));
    expect(denied.status).toBe(403);
    const deniedPatch = await activate("PHONEPE", staff.token);
    expect(deniedPatch.status).toBe(403);
    const ok = await getConfig(jreq("http://localhost/api/v1/admin/payments/config", { token: admin.token }));
    expect(ok.status).toBe(200);
    const view = (await ok.json()).data;
    expect(view.gateways.map((g: { key: string }) => g.key).sort()).toEqual(["PHONEPE", "RAZORPAY"]);
    expect(view.gateways.every((g: { configured: boolean }) => g.configured)).toBe(true);
  });

  it("[cfg-no-secret-leak] config responses never contain a stored secret value", async () => {
    const res = await getConfig(jreq("http://localhost/api/v1/admin/payments/config", { token: admin.token }));
    const text = await res.text();
    for (const secret of [RZP.keySecret, RZP.webhookSecret, PP.clientSecret, PP.webhookPassword]) expect(text).not.toContain(secret);
    const view = JSON.parse(text).data;
    const r = view.gateways.find((g: { key: string }) => g.key === "RAZORPAY");
    expect(r.storedFields).toContain("apiSecret");
    expect(r.webhook.url).toBe("http://localhost:3000/api/v1/webhooks/razorpay");
  });

  it("[cfg-single-active] activating one gateway deactivates the other, and is audited", async () => {
    expect((await activate("PHONEPE")).status).toBe(200);
    expect(await activeGatewayNames()).toEqual(["PhonePe Payment Gateway"]);
    expect((await activate("RAZORPAY")).status).toBe(200);
    expect(await activeGatewayNames()).toEqual(["Razorpay"]);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment_gateway.switched"));
    expect(logs.length).toBe(2);
    expect(logs[0].actorId).toBe(admin.id);
  });

  it("[cfg-invalid-gateway] unsupported gateways and extra fields are rejected (400)", async () => {
    const bad = await patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: "CASHFREE" }, token: admin.token }));
    expect(bad.status).toBe(400);
    const extra = await patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: "RAZORPAY", x: 1 }, token: admin.token }));
    expect(extra.status).toBe(400);
    const route = await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/cashfree/credentials", { method: "PUT", body: { keyId: "x" }, token: admin.token }),
      ctxParams("gateway", "cashfree")
    );
    expect(route.status).toBe(400);
  });

  it("[cfg-concurrent-switch] concurrent switches always leave exactly one active gateway", async () => {
    const keys: Array<"RAZORPAY" | "PHONEPE"> = ["RAZORPAY", "PHONEPE", "RAZORPAY", "PHONEPE", "PHONEPE", "RAZORPAY"];
    const results = await Promise.all(keys.map((k) => activate(k)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await activeGatewayNames()).length).toBe(1);
  });

  it("[cfg-credentials] credentials are stored encrypted, audited by field name only, validated and RBAC-protected", async () => {
    const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.name, "Razorpay"));
    const stored = JSON.stringify(row.config);
    expect(stored).not.toContain(RZP.keySecret);
    expect(stored).not.toContain(RZP.keyId);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment_gateway.credentials_updated"));
    expect(logs.length).toBe(2);
    const auditText = JSON.stringify(logs);
    for (const secret of [RZP.keySecret, RZP.webhookSecret, PP.clientSecret, PP.webhookPassword, RZP.keyId]) expect(auditText).not.toContain(secret);
    expect(auditText).toContain("keySecret");

    const badId = await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { keyId: "not-a-key" }, token: admin.token }),
      ctxParams("gateway", "razorpay")
    );
    expect(badId.status).toBe(400);
    const empty = await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: {}, token: admin.token }),
      ctxParams("gateway", "razorpay")
    );
    expect(empty.status).toBe(400);
    const unknown = await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { keySecret: "abcdefgh12", foo: "bar" }, token: admin.token }),
      ctxParams("gateway", "razorpay")
    );
    expect(unknown.status).toBe(400);
    const staff = await createAdmin("STAFF_ADMIN");
    const denied = await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { keySecret: "abcdefgh12" }, token: staff.token }),
      ctxParams("gateway", "razorpay")
    );
    expect(denied.status).toBe(403);
  });

  it("[cfg-test-connection] test-connection reaches the gateway; wrong credentials report ok:false", async () => {
    const r = await testConnection(jreq("http://localhost/api/v1/admin/payments/config/razorpay/test-connection", { method: "POST", body: {}, token: admin.token }), ctxParams("gateway", "razorpay"));
    expect(r.status).toBe(200);
    expect((await r.json()).data.ok).toBe(true);
    const p = await testConnection(jreq("http://localhost/api/v1/admin/payments/config/phonepe/test-connection", { method: "POST", body: {}, token: admin.token }), ctxParams("gateway", "phonepe"));
    expect((await p.json()).data.ok).toBe(true);

    await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { keySecret: "wrong-secret-value" }, token: admin.token }),
      ctxParams("gateway", "razorpay")
    );
    const bad = await testConnection(jreq("http://localhost/api/v1/admin/payments/config/razorpay/test-connection", { method: "POST", body: {}, token: admin.token }), ctxParams("gateway", "razorpay"));
    expect((await bad.json()).data.ok).toBe(false);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment_gateway.connection_tested"));
    expect(logs.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("Razorpay checkout / confirm / verify", () => {
  it("[rzp-checkout] creates a real order at the gateway with the PLAN amount; the client cannot choose the amount", async () => {
    await activate("RAZORPAY");
    const member = await createVerifiedMember("rzp-checkout");
    const { res, body } = await startCheckout(member.sessionToken);
    expect(res.status).toBe(200);
    expect(body.data.amountInPaise).toBe(19900);
    expect(body.data.gatewayCheckout).toMatchObject({ provider: "RAZORPAY", keyId: RZP.keyId, amount: 19900, currency: "INR" });
    expect(JSON.stringify(body)).not.toContain(RZP.keySecret);
    const order = rzp.orders.get(body.data.gatewayCheckout.orderId)!;
    expect(order.amount).toBe(19900);
    const create = rzp.requests.find((r) => r.path === "/v1/orders" && r.method === "POST")!;
    expect(create.headers.authorization).toBe("Basic " + Buffer.from(`${RZP.keyId}:${RZP.keySecret}`).toString("base64"));

    const forged = await checkout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_7DAY_INR", amountInPaise: 1 }, token: member.sessionToken }));
    expect(forged.status).toBe(400);
  });

  it("[rzp-confirm-bad-signature] a wrong signature is rejected (400, session kept), audited, and grants nothing", async () => {
    const p = await razorpayPending("rzp-badsig");
    rzp.capture(p.orderId);
    const res = await confirmRazorpay(
      jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, {
        body: { razorpay_payment_id: "pay_abcdef123456", razorpay_order_id: p.orderId, razorpay_signature: "0".repeat(64) },
        token: p.member.sessionToken,
      }),
      ctxParams("paymentId", p.paymentId)
    );
    expect(res.status).toBe(400);
    expect((await paymentRow(p.paymentId)).status).toBe("PENDING");
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.signature_mismatch"));
    expect(logs.length).toBe(1);
  });

  it("[rzp-confirm-wrong-order] an order id that is not the stored one is refused (400)", async () => {
    const p = await razorpayPending("rzp-wrongorder");
    const res = await confirmRazorpay(
      jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, {
        body: { razorpay_payment_id: "pay_abcdef123456", razorpay_order_id: "order_someoneelses1", razorpay_signature: "a".repeat(64) },
        token: p.member.sessionToken,
      }),
      ctxParams("paymentId", p.paymentId)
    );
    expect(res.status).toBe(400);
  });

  it("[rzp-confirm-idor] another member cannot confirm my payment", async () => {
    const p = await razorpayPending("rzp-idor-a");
    const other = await createVerifiedMember("rzp-idor-b");
    const res = await confirmRazorpay(
      jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, {
        body: { razorpay_payment_id: "pay_abcdef123456", razorpay_order_id: p.orderId, razorpay_signature: "a".repeat(64) },
        token: other.sessionToken,
      }),
      ctxParams("paymentId", p.paymentId)
    );
    expect(res.status).toBe(403);
  });

  it("[rzp-valid-signature-uncaptured] a valid signature alone does NOT activate — the gateway must report a captured payment", async () => {
    const p = await razorpayPending("rzp-uncaptured");
    const payId = "pay_abcdef123456";
    const sig = createHmac("sha256", RZP.keySecret).update(`${p.orderId}|${payId}`).digest("hex");
    const res = await confirmRazorpay(
      jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, {
        body: { razorpay_payment_id: payId, razorpay_order_id: p.orderId, razorpay_signature: sig },
        token: p.member.sessionToken,
      }),
      ctxParams("paymentId", p.paymentId)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("PENDING");
    expect((await paymentRow(p.paymentId)).status).toBe("PENDING");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("PENDING");
  });

  it("[rzp-captured-activates] valid signature + gateway-captured payment activates membership and issues exactly one invoice, even on replay", async () => {
    const p = await razorpayPending("rzp-captured");
    const payId = rzp.capture(p.orderId);
    const sig = createHmac("sha256", RZP.keySecret).update(`${p.orderId}|${payId}`).digest("hex");
    const call = () =>
      confirmRazorpay(
        jreq(`http://localhost/api/v1/payments/${p.paymentId}/razorpay/confirm`, {
          body: { razorpay_payment_id: payId, razorpay_order_id: p.orderId, razorpay_signature: sig },
          token: p.member.sessionToken,
        }),
        ctxParams("paymentId", p.paymentId)
      );
    const [a, b, c] = await Promise.all([call(), call(), call()]);
    for (const r of [a, b, c]) expect(r.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("ACTIVE");
    const inv = await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId));
    expect(inv.length).toBe(1);
    const again = await call();
    expect(again.status).toBe(200);
    expect((await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId))).length).toBe(1);
  });

  it("[rzp-amount-mismatch] a captured payment for the wrong amount fails the payment and never activates", async () => {
    const p = await razorpayPending("rzp-mismatch");
    rzp.capture(p.orderId, { amount: 100 });
    const v = await verifyPayment(jreq(`http://localhost/api/v1/payments/${p.paymentId}/verify`, { body: {}, token: p.member.sessionToken }), ctxParams("paymentId", p.paymentId));
    expect(v.status).toBe(200);
    expect((await v.json()).data.status).toBe("FAILED");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).not.toBe("ACTIVE");
  });

  it("[rzp-gateway-down] an unreachable / erroring gateway at checkout fails safely with no activation", async () => {
    await activate("RAZORPAY");
    const member = await createVerifiedMember("rzp-down");
    rzp.failNext = { status: 500 };
    const { res } = await startCheckout(member.sessionToken);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const rows = await db.select().from(memberships);
    expect(rows.some((m) => m.status === "ACTIVE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Razorpay webhooks", () => {
  it("[rzp-wh-bad-signature] bad / missing signature → 401, nothing recorded", async () => {
    const payload = { event: "payment.captured", payload: { payment: { entity: { order_id: "order_x" } } } };
    const bad = await razorpayWebhook(rzpWebhookReq(payload, { sig: "f".repeat(64) }) as never);
    expect(bad.status).toBe(401);
    const none = await razorpayWebhook(new Request("http://localhost/api/v1/webhooks/razorpay", { method: "POST", body: JSON.stringify(payload) }) as never);
    expect(none.status).toBe(401);
    const wrongSecret = await razorpayWebhook(rzpWebhookReq(payload, { secret: "some-other-secret" }) as never);
    expect(wrongSecret.status).toBe(401);
    expect((await db.select().from(paymentWebhookEvents)).length).toBe(0);
  });

  it("[rzp-wh-no-secret] without a configured webhook secret the endpoint refuses (503) instead of accepting unsigned calls", async () => {
    await db.update(paymentGateways).set({ config: null }).where(eq(paymentGateways.name, "Razorpay"));
    const res = await razorpayWebhook(rzpWebhookReq({ event: "payment.captured" }) as never);
    expect(res.status).toBe(503);
  });

  it("[rzp-wh-activates-from-gateway-state] a signed payment.captured webhook re-reads the gateway and activates; duplicate delivery is idempotent", async () => {
    const p = await razorpayPending("rzp-wh-ok");
    rzp.capture(p.orderId);
    const payload = { event: "payment.captured", payload: { payment: { entity: { order_id: p.orderId, status: "captured", amount: 19900 } } } };
    const first = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_1" }) as never);
    expect(first.status).toBe(200);
    expect((await first.json()).data.outcome).toBe("PROCESSED");
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");
    const dup = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_1" }) as never);
    expect((await dup.json()).data.outcome).toBe("DUPLICATE");
    expect((await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId))).length).toBe(1);
    expect((await db.select().from(paymentWebhookEvents)).length).toBe(1);
  });

  it("[rzp-wh-forged-claim] a correctly signed webhook CLAIMING capture cannot activate when the gateway says nothing was captured", async () => {
    const p = await razorpayPending("rzp-wh-forged");
    const payload = { event: "payment.captured", payload: { payment: { entity: { order_id: p.orderId, status: "captured", amount: 19900 } } } };
    const res = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_forged" }) as never);
    expect(res.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("PENDING");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("PENDING");
  });

  it("[rzp-wh-unknown-order] an order that is not ours is acknowledged and ignored", async () => {
    const payload = { event: "payment.captured", payload: { payment: { entity: { order_id: "order_unknownxyz" } } } };
    const res = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_unknown" }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.outcome).toBe("IGNORED");
  });

  it("[rzp-wh-retry-after-failure] a FAILED event is processed again on the gateway's retry", async () => {
    const p = await razorpayPending("rzp-wh-retry");
    rzp.capture(p.orderId);
    const payload = { event: "payment.captured", payload: { payment: { entity: { order_id: p.orderId } } } };
    rzp.failNext = { status: 500 };
    const first = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_retry" }) as never);
    expect(first.status).toBe(503);
    const [ev] = await db.select().from(paymentWebhookEvents);
    expect(ev.status).toBe("FAILED");
    const second = await razorpayWebhook(rzpWebhookReq(payload, { eventId: "evt_retry" }) as never);
    expect(second.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");
  });

  it("[rzp-wh-oversize] a body over the limit is refused", async () => {
    const big = "x".repeat(300 * 1024);
    const res = await razorpayWebhook(rzpWebhookReq({ event: "x", pad: big }) as never);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("Razorpay refunds", () => {
  const refundCall = (paymentId: string, body: unknown, token = admin.token) =>
    createRefund(jreq(`http://localhost/api/v1/admin/payments/${paymentId}/refunds`, { body, token }), ctxParams("paymentId", paymentId));

  it("[refund-rbac-validation] staff without payments.review → 403; reason required; unknown fields rejected; non-SUCCESS payment → 409", async () => {
    const p = await razorpayPending("refund-rbac");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await refundCall(p.paymentId, { reason: "customer asked" }, staff.token)).status).toBe(403);
    expect((await refundCall(p.paymentId, {})).status).toBe(400);
    expect((await refundCall(p.paymentId, { reason: "ok reason", extra: 1 })).status).toBe(400);
    expect((await refundCall(p.paymentId, { reason: "not paid yet" })).status).toBe(409);
    await grantPermission("STAFF_ADMIN", "payments.review");
    try {
      expect((await refundCall(p.paymentId, { reason: "not paid yet" }, staff.token)).status).toBe(409);
    } finally {
      await revokePermission("STAFF_ADMIN", "payments.review");
    }
  });

  it("[refund-full-flow] full refund: PENDING at the gateway → webhook processed → payment REFUNDED, membership CANCELLED, invoice VOID, audited", async () => {
    const p = await razorpayPaid("refund-full");
    const res = await refundCall(p.paymentId, { reason: "member requested full refund" });
    expect(res.status).toBe(201);
    const refund = (await res.json()).data.refund;
    expect(refund.status).toBe("PENDING");
    expect(refund.amountInPaise).toBe(19900);
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");

    const call = rzp.requests.find((r) => r.method === "POST" && r.path.endsWith("/refund"))!;
    expect(call.path).toBe(`/v1/payments/${p.gatewayPaymentId}/refund`);
    expect(JSON.parse(call.body).amount).toBe(19900);

    rzp.setRefundStatus(refund.providerRefundId, "processed");
    const wh = await razorpayWebhook(rzpWebhookReq({ event: "refund.processed", payload: { refund: { entity: { id: refund.providerRefundId } } } }, { eventId: "evt_refund_1" }) as never);
    expect(wh.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("REFUNDED");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("CANCELLED");
    const [inv] = await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId));
    expect(inv.status).toBe("VOID");
    const [r] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, refund.id));
    expect(r.status).toBe("PROCESSED");
    const actions = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(actions).toContain("payment.refund_requested");
    expect(actions).toContain("payment.refund_processed");
    expect(actions).toContain("payment.fully_refunded");

    const list = await listRefunds(jreq(`http://localhost/api/v1/admin/payments/${p.paymentId}/refunds`, { token: admin.token }), ctxParams("paymentId", p.paymentId));
    expect((await list.json()).data.refundableInPaise).toBe(0);
  });

  it("[refund-partial-and-over-refund] a partial refund leaves the payment SUCCESS; refunding more than the balance → 409", async () => {
    const p = await razorpayPaid("refund-partial");
    rzp.newRefundStatus = "processed";
    const first = await refundCall(p.paymentId, { amountInPaise: 5000, reason: "goodwill gesture" });
    expect(first.status).toBe(201);
    expect((await first.json()).data.refund.status).toBe("PROCESSED");
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("ACTIVE");
    const over = await refundCall(p.paymentId, { amountInPaise: 15000, reason: "too much" });
    expect(over.status).toBe(409);
    const rest = await refundCall(p.paymentId, { reason: "refund the remainder" });
    expect(rest.status).toBe(201);
    expect((await paymentRow(p.paymentId)).status).toBe("REFUNDED");
  });

  it("[refund-concurrent] concurrent refund requests can never refund more than the payment amount", async () => {
    const p = await razorpayPaid("refund-concurrent");
    const results = await Promise.all([1, 2, 3, 4].map(() => refundCall(p.paymentId, { amountInPaise: 10000, reason: "race" })));
    const okCount = results.filter((r) => r.status === 201).length;
    expect(okCount).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    const rows = await db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, p.paymentId));
    expect(rows.filter((r) => r.status !== "FAILED").reduce((n, r) => n + r.amountInPaise, 0)).toBeLessThanOrEqual(19900);
  });

  it("[refund-gateway-failure] a gateway error marks the refund FAILED and frees the balance", async () => {
    const p = await razorpayPaid("refund-gwfail");
    rzp.failNext = { status: 500 };
    const res = await refundCall(p.paymentId, { reason: "gateway will fail" });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const rows = await db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, p.paymentId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("FAILED");
    const retry = await refundCall(p.paymentId, { reason: "retry after failure" });
    expect(retry.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("PhonePe checkout / webhooks / refunds", () => {
  async function phonepePending(label: string) {
    await activate("PHONEPE");
    const member = await createVerifiedMember(label);
    const { res, body } = await startCheckout(member.sessionToken);
    expect(res.status).toBe(200);
    return { member, paymentId: body.data.paymentId as string, membershipId: body.data.membershipId as string, body, merchantOrderId: [...pp.orders.keys()][0] };
  }

  it("[pp-checkout] obtains an O-Bearer token, creates the order with the plan amount, returns only a redirect URL", async () => {
    const p = await phonepePending("pp-checkout");
    expect(p.body.data.gatewayCheckout.provider).toBe("PHONEPE");
    expect(p.body.data.gatewayCheckout.redirectUrl).toMatch(/^https:\/\//);
    expect(JSON.stringify(p.body)).not.toContain(PP.clientSecret);
    expect(pp.orders.get(p.merchantOrderId)!.amount).toBe(19900);
    expect(pp.tokensIssued).toBe(1);
    const pay = pp.requests.find((r) => r.path === "/pg/checkout/v2/pay")!;
    expect(pay.headers.authorization).toBe("O-Bearer mock-phonepe-access-token");
    expect(JSON.parse(pay.body).paymentFlow.merchantUrls.redirectUrl).toContain("/membership/payment-return?paymentId=");
  });

  it("[pp-wh-auth] missing / wrong Authorization → 401; no webhook credentials configured → 503", async () => {
    const payload = { event: "checkout.order.completed", payload: { merchantOrderId: "x", state: "COMPLETED" } };
    expect((await phonepeWebhook(ppWebhookReq(payload) as never)).status).toBe(401);
    expect((await phonepeWebhook(ppWebhookReq(payload, "deadbeef") as never)).status).toBe(401);
    expect((await phonepeWebhook(ppWebhookReq(payload, phonepeAuthorizationValue("ppuser", "wrong-password")) as never)).status).toBe(401);
    expect((await db.select().from(paymentWebhookEvents)).length).toBe(0);
    await putCredentials(
      jreq("http://localhost/api/v1/admin/payments/config/phonepe/credentials", { method: "PUT", body: { mode: "test", clientId: PP.clientId }, token: admin.token }),
      ctxParams("gateway", "phonepe")
    );
    await db.execute(sql`UPDATE payment_gateways SET config = jsonb_set(config, '{encrypted}', (config->'encrypted') - 'webhookUsername' - 'webhookPassword') WHERE name = 'PhonePe Payment Gateway'`);
    expect((await phonepeWebhook(ppWebhookReq(payload, ppAuth()) as never)).status).toBe(503);
  });

  it("[pp-wh-activates-from-gateway-state] authenticated completed webhook → status re-read → membership activated; duplicate is idempotent; both Authorization forms accepted", async () => {
    const p = await phonepePending("pp-wh-ok");
    pp.setOrderState(p.merchantOrderId, "COMPLETED");
    const payload = { event: "checkout.order.completed", payload: { merchantOrderId: p.merchantOrderId, state: "COMPLETED", amount: 19900 } };
    const first = await phonepeWebhook(ppWebhookReq(payload, `SHA256 ${ppAuth()}`) as never);
    expect(first.status).toBe(200);
    expect((await first.json()).data.outcome).toBe("PROCESSED");
    expect((await paymentRow(p.paymentId)).status).toBe("SUCCESS");
    const dup = await phonepeWebhook(ppWebhookReq(payload, ppAuth()) as never);
    expect((await dup.json()).data.outcome).toBe("DUPLICATE");
    expect((await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId))).length).toBe(1);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).toBe("ACTIVE");
  });

  it("[pp-wh-forged-claim] an authenticated webhook claiming completion cannot activate while PhonePe reports PENDING", async () => {
    const p = await phonepePending("pp-wh-forged");
    const payload = { event: "checkout.order.completed", payload: { merchantOrderId: p.merchantOrderId, state: "COMPLETED", amount: 19900 } };
    const res = await phonepeWebhook(ppWebhookReq(payload, ppAuth()) as never);
    expect(res.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("PENDING");
  });

  it("[pp-failed] a FAILED state closes the payment without activating", async () => {
    const p = await phonepePending("pp-failed");
    pp.setOrderState(p.merchantOrderId, "FAILED");
    const payload = { event: "checkout.order.failed", payload: { merchantOrderId: p.merchantOrderId, state: "FAILED" } };
    expect((await phonepeWebhook(ppWebhookReq(payload, ppAuth()) as never)).status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("FAILED");
    const [m] = await db.select().from(memberships).where(eq(memberships.id, p.membershipId));
    expect(m.status).not.toBe("ACTIVE");
  });

  it("[pp-amount-mismatch] a COMPLETED order for the wrong amount does not activate", async () => {
    const p = await phonepePending("pp-mismatch");
    pp.setOrderState(p.merchantOrderId, "COMPLETED", 100);
    const v = await verifyPayment(jreq(`http://localhost/api/v1/payments/${p.paymentId}/verify`, { body: {}, token: p.member.sessionToken }), ctxParams("paymentId", p.paymentId));
    expect((await v.json()).data.status).toBe("FAILED");
  });

  it("[pp-refund-flow] refund via /payments/v2/refund, finalised by the pg.refund.completed webhook → REFUNDED", async () => {
    const p = await phonepePending("pp-refund");
    pp.setOrderState(p.merchantOrderId, "COMPLETED");
    const v = await verifyPayment(jreq(`http://localhost/api/v1/payments/${p.paymentId}/verify`, { body: {}, token: p.member.sessionToken }), ctxParams("paymentId", p.paymentId));
    expect((await v.json()).data.status).toBe("SUCCESS");

    const res = await createRefund(jreq(`http://localhost/api/v1/admin/payments/${p.paymentId}/refunds`, { body: { reason: "full refund please" }, token: admin.token }), ctxParams("paymentId", p.paymentId));
    expect(res.status).toBe(201);
    const refund = (await res.json()).data.refund;
    expect(refund.status).toBe("PENDING");
    const sent = JSON.parse(pp.requests.find((r) => r.path === "/pg/payments/v2/refund")!.body);
    expect(sent).toMatchObject({ originalMerchantOrderId: p.merchantOrderId, amount: 19900, merchantRefundId: refund.refundRef });

    pp.setRefundState(refund.refundRef, "COMPLETED");
    const wh = await phonepeWebhook(ppWebhookReq({ event: "pg.refund.completed", payload: { merchantRefundId: refund.refundRef, state: "COMPLETED" } }, ppAuth()) as never);
    expect(wh.status).toBe(200);
    expect((await paymentRow(p.paymentId)).status).toBe("REFUNDED");
    const [inv] = await db.select().from(invoices).where(eq(invoices.paymentId, p.paymentId));
    expect(inv.status).toBe("VOID");
  });
});
