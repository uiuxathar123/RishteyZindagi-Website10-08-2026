/**
 * B8: invoice generation on genuine payment success — exact invoice
 * number format, per-invoice uniqueness, stored-PDF read-back, member
 * IDOR, and admin cancel (VOID) / regenerate.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { GET as listMyInvoices } from "@/app/api/v1/invoices/me/route";
import { GET as getMyInvoice } from "@/app/api/v1/invoices/[invoiceId]/route";
import { GET as downloadMyInvoice } from "@/app/api/v1/invoices/[invoiceId]/download/route";
import { GET as getInvoiceForAdmin } from "@/app/api/v1/admin/invoices/[invoiceId]/route";
import { POST as cancelInvoice } from "@/app/api/v1/admin/invoices/[invoiceId]/cancel/route";
import { POST as regenerateInvoice } from "@/app/api/v1/admin/invoices/[invoiceId]/regenerate/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs, invoices } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { INVOICE_NUMBER_PATTERN } from "@/server/modules/invoices/invoice-number";
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
  const email = `inv-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Invoices Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

/** Purchases a plan and verifies it to a genuine SUCCESS, returning the
 * resulting membershipId/paymentId — the invoice is issued as a side
 * effect of that verify step (see invoices.service.ts's own top-of-file
 * comment: never at checkout/PENDING time). */
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

async function findInvoiceByPaymentId(paymentId: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1);
  return row;
}

async function requireInvoiceByPaymentId(paymentId: string) {
  const row = await findInvoiceByPaymentId(paymentId);
  if (!row) throw new Error(`No invoice found for paymentId ${paymentId}`);
  return row;
}

describe("B8 invoices", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
  });

  it("[inv-created-on-success] a genuine payment SUCCESS issues exactly one invoice, number matching the documented format", async () => {
    const member = await createVerifiedMember("inv-created");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    expect(invoiceRow.invoiceNumber).toMatch(INVOICE_NUMBER_PATTERN);
    expect(invoiceRow.status).toBe("ISSUED");
    expect(invoiceRow.amountInPaise).toBeGreaterThan(19900); // base + configured tax
  });

  it("[inv-not-issued-on-pending-or-failed] a PENDING or FAILED payment never issues an invoice", async () => {
    const member = await createVerifiedMember("inv-not-issued");
    const checkoutRes = await checkout(
      preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR", devSimulateOutcome: "FAILED" }, member.sessionToken)
    );
    const { data: checkoutData } = await checkoutRes.json();
    await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, member.sessionToken), {
      params: { paymentId: checkoutData.paymentId },
    });
    const invoiceRow = await findInvoiceByPaymentId(checkoutData.paymentId);
    expect(invoiceRow).toBeUndefined();
  });

  it("[inv-uniqueness] two invoices issued in the same test run never collide on invoiceNumber", async () => {
    const memberA = await createVerifiedMember("inv-unique-a");
    const memberB = await createVerifiedMember("inv-unique-b");
    const a = await purchaseAndActivate(memberA.sessionToken, "PLAN_7DAY_INR");
    const b = await purchaseAndActivate(memberB.sessionToken, "PLAN_7DAY_INR");
    const invoiceA = await requireInvoiceByPaymentId(a.paymentId);
    const invoiceB = await requireInvoiceByPaymentId(b.paymentId);
    expect(invoiceA.invoiceNumber).not.toBe(invoiceB.invoiceNumber);
  });

  it("[inv-snapshot-immutable-on-void] cancelling (VOID) preserves the invoice number and financial snapshot, only status/cancellation fields change", async () => {
    const member = await createVerifiedMember("inv-void");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_MONTHLY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const token = await seedAdmin("SUPER_ADMIN");

    const res = await cancelInvoice(preq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}/cancel`, { reason: "Duplicate purchase, refunded outside this system." }, token), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.invoice.status).toBe("VOID");
    expect(data.invoice.invoiceNumber).toBe(invoiceRow.invoiceNumber);
    expect(data.invoice.amountInPaise).toBe(invoiceRow.amountInPaise);
    expect(data.invoice.cancellationReason).toContain("Duplicate purchase");

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "invoice.voided"));
    expect(logs.some((l) => l.entityId === invoiceRow.id)).toBe(true);
  });

  it("[inv-void-idempotent] voiding an already-VOID invoice a second time is a no-op, not an error", async () => {
    const member = await createVerifiedMember("inv-void-twice");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const token = await seedAdmin("SUPER_ADMIN");
    await cancelInvoice(preq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}/cancel`, { reason: "first" }, token), {
      params: { invoiceId: invoiceRow.id },
    });
    const res = await cancelInvoice(preq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}/cancel`, { reason: "second" }, token), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.invoice.status).toBe("VOID");
  });

  it("[inv-download-pdf] a member can download their own invoice's stored PDF", async () => {
    const member = await createVerifiedMember("inv-download");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const res = await downloadMyInvoice(greq(`http://localhost/api/v1/invoices/${invoiceRow.id}/download`, member.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF"); // real PDF magic bytes
  });

  it("[inv-idor] a member cannot read, list, or download another member's invoice", async () => {
    const owner = await createVerifiedMember("inv-idor-owner");
    const intruder = await createVerifiedMember("inv-idor-intruder");
    const { paymentId } = await purchaseAndActivate(owner.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);

    const getRes = await getMyInvoice(greq(`http://localhost/api/v1/invoices/${invoiceRow.id}`, intruder.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(getRes.status).toBe(403);

    const downloadRes = await downloadMyInvoice(greq(`http://localhost/api/v1/invoices/${invoiceRow.id}/download`, intruder.sessionToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(downloadRes.status).toBe(403);

    const listRes = await listMyInvoices(greq("http://localhost/api/v1/invoices/me", intruder.sessionToken));
    const { data: listData } = await listRes.json();
    expect(listData.invoices).toHaveLength(0);
  });

  it("[inv-admin-cannot-read-via-member-endpoint] an admin without payments.review still cannot read a member's invoice via the member-facing endpoint", async () => {
    const member = await createVerifiedMember("inv-admin-no-bypass");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const staffToken = await seedAdmin("STAFF_ADMIN");

    const res = await getMyInvoice(greq(`http://localhost/api/v1/invoices/${invoiceRow.id}`, staffToken), { params: { invoiceId: invoiceRow.id } });
    expect(res.status).toBe(403);
  });

  it("[inv-admin-read] an admin with payments.review can read any invoice via the dedicated admin endpoint; a STAFF_ADMIN without it cannot", async () => {
    const member = await createVerifiedMember("inv-admin-read");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);

    const superToken = await seedAdmin("SUPER_ADMIN");
    const okRes = await getInvoiceForAdmin(greq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}`, superToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(okRes.status).toBe(200);

    const staffToken = await seedAdmin("STAFF_ADMIN");
    const deniedRes = await getInvoiceForAdmin(greq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}`, staffToken), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(deniedRes.status).toBe(403);
  });

  it("[inv-admin-regenerate] admin regenerate re-renders the PDF under a new storage key, preserving the invoice number and amount exactly", async () => {
    const member = await createVerifiedMember("inv-regen");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const before = await requireInvoiceByPaymentId(paymentId);
    const token = await seedAdmin("SUPER_ADMIN");

    const res = await regenerateInvoice(
      preq(`http://localhost/api/v1/admin/invoices/${before.id}/regenerate`, { reason: "Fixing a rendering bug." }, token),
      { params: { invoiceId: before.id } }
    );
    expect(res.status).toBe(200);

    const [after] = await db.select().from(invoices).where(eq(invoices.id, before.id));
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
    expect(after.amountInPaise).toBe(before.amountInPaise);
    expect(after.pdfStorageKey).not.toBe(before.pdfStorageKey);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "invoice.pdf_regenerated"));
    expect(logs.some((l) => l.entityId === before.id)).toBe(true);
  });

  it("[inv-cancel-requires-reason] cancelling without a reason is rejected", async () => {
    const member = await createVerifiedMember("inv-no-reason");
    const { paymentId } = await purchaseAndActivate(member.sessionToken, "PLAN_7DAY_INR");
    const invoiceRow = await requireInvoiceByPaymentId(paymentId);
    const token = await seedAdmin("SUPER_ADMIN");
    const res = await cancelInvoice(preq(`http://localhost/api/v1/admin/invoices/${invoiceRow.id}/cancel`, { reason: "" }, token), {
      params: { invoiceId: invoiceRow.id },
    });
    expect(res.status).toBe(400);
  });
});
