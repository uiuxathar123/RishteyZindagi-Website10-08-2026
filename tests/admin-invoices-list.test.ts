/**
 * B9: admin invoice search/filter/list + admin membership list/filter —
 * both genuinely new endpoints (B8 only shipped single-invoice-by-id
 * lookup and a member's own membership view). Both reuse `payments
 * .review` (the same billing-admin permission B8's payment/invoice admin
 * actions already use).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as searchInvoices } from "@/app/api/v1/admin/invoices/route";
import { GET as listMemberships } from "@/app/api/v1/admin/memberships/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, invoices, paymentGateways, membershipPlans } from "@/server/db/schema";
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
  const email = `invadmin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Inv Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

async function purchaseAndActivate(token: string, planCode: string) {
  const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode, devSimulateOutcome: "SUCCESS" }, token));
  const { data: checkoutData } = await checkoutRes.json();
  const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, token), {
    params: { paymentId: checkoutData.paymentId },
  });
  const { data: verifyData } = await verifyRes.json();
  expect(verifyData.status).toBe("SUCCESS");
  return { membershipId: checkoutData.membershipId as string, paymentId: checkoutData.paymentId as string };
}

describe("B9 admin invoice search + membership list", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
  });

  // --- Permission gating -----------------------------------------------------

  it("[invoices-idor] unauthenticated gets 401; a plain member gets 403; a STAFF_ADMIN without payments.review gets 403", async () => {
    const unauth = await searchInvoices(greq("http://localhost/api/v1/admin/invoices"));
    expect(unauth.status).toBe(401);

    const member = await createVerifiedMember("inv-search-member");
    const denied = await searchInvoices(greq("http://localhost/api/v1/admin/invoices", member.sessionToken));
    expect(denied.status).toBe(403);

    const staffToken = await seedAdmin("STAFF_ADMIN");
    const staffDenied = await searchInvoices(greq("http://localhost/api/v1/admin/invoices", staffToken));
    expect(staffDenied.status).toBe(403);
  });

  it("[memberships-idor] unauthenticated gets 401; a plain member gets 403; a STAFF_ADMIN without payments.review gets 403", async () => {
    const unauth = await listMemberships(greq("http://localhost/api/v1/admin/memberships"));
    expect(unauth.status).toBe(401);

    const member = await createVerifiedMember("mem-list-member");
    const denied = await listMemberships(greq("http://localhost/api/v1/admin/memberships", member.sessionToken));
    expect(denied.status).toBe(403);

    const staffToken = await seedAdmin("STAFF_ADMIN");
    const staffDenied = await listMemberships(greq("http://localhost/api/v1/admin/memberships", staffToken));
    expect(staffDenied.status).toBe(403);
  });

  // --- Invoice search filters --------------------------------------------

  it("[invoices-search-filters] every filter dimension narrows results correctly", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const buyerA = await createVerifiedMember("inv-search-a");
    const buyerB = await createVerifiedMember("inv-search-b");
    const { paymentId: paymentA } = await purchaseAndActivate(buyerA.sessionToken, "PLAN_7DAY_INR");
    const { paymentId: paymentB } = await purchaseAndActivate(buyerB.sessionToken, "PLAN_MONTHLY_INR");

    const [invoiceA] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentA));
    const [invoiceB] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentB));
    const [razorpay] = await db.select().from(paymentGateways).where(eq(paymentGateways.name, "Razorpay"));
    const [plan7day] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, "PLAN_7DAY_INR"));

    // invoiceNumber (partial)
    const byNumber = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?invoiceNumber=${invoiceA.invoiceNumber}`, superToken));
    const { data: byNumberData } = await byNumber.json();
    expect(byNumberData.items.map((i: { id: string }) => i.id)).toEqual([invoiceA.id]);

    // userId
    const byUser = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?userId=${buyerB.userId}`, superToken));
    const { data: byUserData } = await byUser.json();
    expect(byUserData.items.every((i: { userId: string }) => i.userId === buyerB.userId)).toBe(true);
    expect(byUserData.items.some((i: { id: string }) => i.id === invoiceB.id)).toBe(true);

    // planId (via membership -> plan)
    const byPlan = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?planId=${plan7day.id}`, superToken));
    const { data: byPlanData } = await byPlan.json();
    expect(byPlanData.items.some((i: { id: string }) => i.id === invoiceA.id)).toBe(true);
    expect(byPlanData.items.some((i: { id: string }) => i.id === invoiceB.id)).toBe(false);

    // gateway
    const byGateway = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?gatewayId=${razorpay.id}&pageSize=50`, superToken));
    const { data: byGatewayData } = await byGateway.json();
    expect(byGatewayData.items.length).toBeGreaterThanOrEqual(2);

    // currency
    const byCurrency = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?currency=INR&pageSize=50`, superToken));
    const { data: byCurrencyData } = await byCurrency.json();
    expect(byCurrencyData.items.length).toBeGreaterThanOrEqual(2);

    // paymentStatus=SUCCESS matches (every invoice here came from a
    // SUCCESS payment — see invoices.service.ts's issuance-timing rule)
    const bySuccess = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?paymentStatus=SUCCESS&pageSize=50`, superToken));
    const { data: bySuccessData } = await bySuccess.json();
    expect(bySuccessData.items.some((i: { id: string }) => i.id === invoiceA.id)).toBe(true);

    // paymentStatus=FAILED matches nothing (no invoice is ever issued for
    // a FAILED payment) — proves the join filters correctly, not just
    // "any invoice at all".
    const byFailed = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?paymentStatus=FAILED`, superToken));
    const { data: byFailedData } = await byFailed.json();
    expect(byFailedData.items.some((i: { id: string }) => i.id === invoiceA.id || i.id === invoiceB.id)).toBe(false);

    // amount range
    const byAmount = await searchInvoices(
      greq(`http://localhost/api/v1/admin/invoices?amountMin=${invoiceA.amountInPaise}&amountMax=${invoiceA.amountInPaise}`, superToken)
    );
    const { data: byAmountData } = await byAmount.json();
    expect(byAmountData.items.some((i: { id: string }) => i.id === invoiceA.id)).toBe(true);
    expect(byAmountData.items.some((i: { id: string }) => i.id === invoiceB.id)).toBe(false);

    // date range (issuedAt is "now" for both — a window around now must
    // include both, a window entirely in the past must include neither)
    const dateFrom = new Date(Date.now() - 60_000).toISOString();
    const dateTo = new Date(Date.now() + 60_000).toISOString();
    const byDate = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?dateFrom=${dateFrom}&dateTo=${dateTo}&pageSize=50`, superToken));
    const { data: byDateData } = await byDate.json();
    expect(byDateData.items.some((i: { id: string }) => i.id === invoiceA.id)).toBe(true);
    expect(byDateData.items.some((i: { id: string }) => i.id === invoiceB.id)).toBe(true);

    const oldDateTo = new Date(Date.now() - 60_000).toISOString();
    const byOldDate = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?dateTo=${oldDateTo}`, superToken));
    const { data: byOldDateData } = await byOldDate.json();
    expect(byOldDateData.items.some((i: { id: string }) => i.id === invoiceA.id || i.id === invoiceB.id)).toBe(false);

    // transactionId (partial match against internal transactionRef)
    expect(byNumberData.items[0].transactionRef).toBeTruthy();
    const txnRef = byNumberData.items[0].transactionRef as string;
    const byTxn = await searchInvoices(greq(`http://localhost/api/v1/admin/invoices?transactionId=${txnRef}`, superToken));
    const { data: byTxnData } = await byTxn.json();
    expect(byTxnData.items.some((i: { id: string }) => i.id === invoiceA.id)).toBe(true);
  });

  it("[invoices-pagination] page/pageSize are honored", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const buyerA = await createVerifiedMember("inv-page-a");
    const buyerB = await createVerifiedMember("inv-page-b");
    await purchaseAndActivate(buyerA.sessionToken, "PLAN_7DAY_INR");
    await purchaseAndActivate(buyerB.sessionToken, "PLAN_7DAY_INR");

    const res = await searchInvoices(greq("http://localhost/api/v1/admin/invoices?page=1&pageSize=1", superToken));
    const { data } = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(1);
    expect(data.total).toBeGreaterThanOrEqual(2);
  });

  it("[invoices-no-secrets] the response never contains a password/token/gateway-credential secret", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const buyer = await createVerifiedMember("inv-nosecret");
    await purchaseAndActivate(buyer.sessionToken, "PLAN_7DAY_INR");
    const res = await searchInvoices(greq("http://localhost/api/v1/admin/invoices?pageSize=50", superToken));
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toMatch(/passwordHash|codeHash|tokenHash|apiSecret|webhookSecret/i);
  });

  // --- Membership admin list -------------------------------------------------

  it("[memberships-list-filters] userId/status/planId filters narrow results correctly", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const activeBuyer = await createVerifiedMember("mem-list-active");
    const pendingBuyer = await createVerifiedMember("mem-list-pending");
    await purchaseAndActivate(activeBuyer.sessionToken, "PLAN_MONTHLY_INR");
    await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, pendingBuyer.sessionToken));

    const [monthlyPlan] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, "PLAN_MONTHLY_INR"));

    const byStatusActive = await listMemberships(greq("http://localhost/api/v1/admin/memberships?status=ACTIVE&pageSize=50", superToken));
    const { data: activeData } = await byStatusActive.json();
    expect(activeData.items.some((m: { userId: string }) => m.userId === activeBuyer.userId)).toBe(true);
    expect(activeData.items.every((m: { status: string }) => m.status === "ACTIVE")).toBe(true);

    const byStatusPending = await listMemberships(greq("http://localhost/api/v1/admin/memberships?status=PENDING&pageSize=50", superToken));
    const { data: pendingData } = await byStatusPending.json();
    expect(pendingData.items.some((m: { userId: string }) => m.userId === pendingBuyer.userId)).toBe(true);

    const byUser = await listMemberships(greq(`http://localhost/api/v1/admin/memberships?userId=${activeBuyer.userId}`, superToken));
    const { data: byUserData } = await byUser.json();
    expect(byUserData.items.every((m: { userId: string }) => m.userId === activeBuyer.userId)).toBe(true);

    const byPlan = await listMemberships(greq(`http://localhost/api/v1/admin/memberships?planId=${monthlyPlan.id}`, superToken));
    const { data: byPlanData } = await byPlan.json();
    expect(byPlanData.items.every((m: { planId: string }) => m.planId === monthlyPlan.id)).toBe(true);
    expect(byPlanData.items.some((m: { userId: string }) => m.userId === activeBuyer.userId)).toBe(true);
  });
});
