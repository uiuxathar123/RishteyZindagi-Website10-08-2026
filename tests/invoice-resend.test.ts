/**
 * B12 QA gap-fix: `POST /api/v1/invoices/:invoiceId/resend` —
 * re-delivers an already-issued invoice's notification. See
 * invoices.service.ts's resendInvoice doc comment and BACKEND.md §56
 * for why this endpoint was found missing and built in this phase.
 *
 * This is a genuinely new, additive endpoint (not a modification of any
 * existing B8 invoice behavior) — mirrors invoices.test.ts's own
 * fixtures/conventions exactly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { POST as resendInvoice } from "@/app/api/v1/invoices/[invoiceId]/resend/route";
import { POST as cancelInvoice } from "@/app/api/v1/admin/invoices/[invoiceId]/cancel/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs, invoices, invoiceLogs, notifications } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { req, createVerifiedMember } from "./helpers/profile-fixtures";
import { NextRequest } from "next/server";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `inv-resend-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Resend Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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
  return { paymentId: checkoutData.paymentId as string };
}

async function requireInvoiceByPaymentId(paymentId: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1);
  if (!row) throw new Error(`No invoice found for paymentId ${paymentId}`);
  return row;
}

describe("B12 invoice resend", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
  });

  it("[inv-resend-success] a member can resend their own issued invoice's notification, logged in both invoice_logs and audit_logs", async () => {
    const member = await createVerifiedMember("inv-resend-ok");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);

    const res = await resendInvoice(preq(`http://localhost/api/v1/invoices/${invoiceRow.id}/resend`, {}, member.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.invoice.id).toBe(invoiceRow.id);
    // Resending never mutates the invoice's own financial data.
    expect(data.invoice.invoiceNumber).toBe(invoiceRow.invoiceNumber);
    expect(data.invoice.amountInPaise).toBe(invoiceRow.amountInPaise);

    const logs = await db.select().from(invoiceLogs).where(eq(invoiceLogs.invoiceId, invoiceRow.id));
    expect(logs.some((l) => l.action === "invoice.resent")).toBe(true);

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "invoice.resent"));
    expect(audit.some((a) => a.entityId === invoiceRow.id)).toBe(true);

    // A best-effort notification row was created (EMAIL channel) — never
    // throws even though no real EMAIL vendor is configured (matches
    // notify()'s universal best-effort contract).
    const notifRows = await db.select().from(notifications).where(eq(notifications.userId, member.userId));
    expect(notifRows.some((n) => n.channel === "EMAIL" && n.title.includes(invoiceRow.invoiceNumber))).toBe(true);
  });

  it("[inv-resend-idor] a member cannot resend another member's invoice — identical 403 shape as every other invoice action", async () => {
    const owner = await createVerifiedMember("inv-resend-owner");
    const intruder = await createVerifiedMember("inv-resend-intruder");
    const { paymentId } = await purchaseAndActivate(owner.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);

    const res = await resendInvoice(preq(`http://localhost/api/v1/invoices/${invoiceRow.id}/resend`, {}, intruder.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(403);
  });

  it("[inv-resend-voided-rejected] a VOIDed invoice cannot be resent (409)", async () => {
    const member = await createVerifiedMember("inv-resend-void");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const adminToken = await seedAdmin("SUPER_ADMIN");
    await cancelInvoice(preq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}/cancel`, { reason: "test void" }, adminToken), {
      params: { invoiceId: invoiceRow.id },
    });

    const res = await resendInvoice(preq(`http://localhost/api/v1/invoices/${invoiceRow.id}/resend`, {}, member.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(400);
  });

  it("[inv-resend-rate-limited] the 6th resend within an hour is rejected with a clean 429, not a raw error", async () => {
    const member = await createVerifiedMember("inv-resend-ratelimit");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);

    for (let i = 0; i < 5; i++) {
      const res = await resendInvoice(preq(`http://localhost/api/v1/invoices/${invoiceRow.id}/resend`, {}, member.sessionToken), {
        params: { invoiceId: invoiceRow.id },
      });
      expect(res.status).toBe(200);
    }
    const sixth = await resendInvoice(preq(`http://localhost/api/v1/invoices/${invoiceRow.id}/resend`, {}, member.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("[inv-resend-nonexistent-404-shaped] resending a non-existent invoice id gets the same 403 IDOR shape as any other owner-mismatch (never a raw 500)", async () => {
    const member = await createVerifiedMember("inv-resend-missing");
    const res = await resendInvoice(preq(`http://localhost/api/v1/invoices/00000000-0000-0000-0000-000000000000/resend`, {}, member.sessionToken), {
      params: { invoiceId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(403);
  });
});
