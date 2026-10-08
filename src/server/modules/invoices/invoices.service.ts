/**
 * B8: invoice issuance, retrieval, cancellation (VOID), and admin
 * regeneration. Every invoice is generated from a `snapshot` captured at
 * issuance time (see schema.ts's `invoices.snapshot` comment) — the
 * stored PDF is never recomputed from possibly-since-changed live data.
 *
 * Generation-timing judgment call (documented again in BACKEND.md): an
 * invoice is issued (and its PDF generated + stored) at the moment a
 * payment's verify step reports genuine SUCCESS (see payments.service
 * .ts's verifyPayment/manualVerifyPayment) — never at checkout/PENDING
 * time, since a PENDING payment might never succeed. `invoices.status`
 * starts at `ISSUED` (meaning "generated, and backend-verified" — the
 * payment that produced it was already a confirmed SUCCESS by
 * construction, since issueInvoice is only ever called from the success
 * path) rather than transitioning to `PAID` as a second step; `PAID` is
 * reserved for a future distinct "invoice was additionally reconciled/
 * settled" concept this phase doesn't need (no such second step exists
 * anywhere in this system yet) — every real invoice in this phase stays
 * `ISSUED` until/unless an admin VOIDs it.
 */
import { eq } from "drizzle-orm";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { getStorageProvider } from "@/server/modules/storage/factory";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import { notify } from "@/server/modules/notifications/notifications.service";
import { db } from "@/server/db/client";
import { users, paymentGateways, profiles, countries, invoices as invoicesTable } from "@/server/db/schema";
import * as repo from "./invoices.repository";
import type { InvoiceRow } from "./invoices.repository";
import { renderInvoicePdf, type InvoiceSnapshot } from "./invoice-pdf";
import { timezoneForCountry, formatInvoiceTimestamp } from "./timezone";
import { computeTax } from "./tax-config";
import type { PaymentRow, TransactionRow } from "@/server/modules/payments/payments.repository";
import type { MembershipRow } from "@/server/modules/memberships/memberships.repository";
import type { MembershipPlanRow } from "@/server/modules/memberships/membership-plans.repository";

const ADMIN_PERMISSION = "payments.review";

// Clearly-labeled placeholder legal content — see this module's own
// BACKEND.md disclosure. No real registered company name/address/GST
// number exists anywhere in this project's data.
const HEADER = {
  companyName: "RishteyZindagi Pvt Ltd",
  companyAddress: "Registered address on file — placeholder, not a real registered address.",
  companyContact: "support@rishteyzindagi.example (placeholder contact)",
  gstPlaceholder: "GSTIN: [placeholder — not a real registration number]",
};

const FOOTER = {
  supportText: "Support: contact support@rishteyzindagi.example for any billing questions.",
  termsText: "This invoice is subject to RishteyZindagi's Terms of Service.",
  privacyText: "See RishteyZindagi's Privacy Policy for how your data is handled.",
  refundCancellationText: "No refunds are issued after a successful payment. Cancelling auto-renew does not end an already-paid period early.",
  legalText: "This is a system-generated invoice. Placeholder legal/company details — see BACKEND.md's B8 section.",
};

export interface IssueInvoiceParams {
  userId: string;
  payment: PaymentRow;
  transaction: TransactionRow;
  membership: MembershipRow;
  plan: MembershipPlanRow;
}

async function buildSnapshot(params: IssueInvoiceParams): Promise<InvoiceSnapshot> {
  const { userId, payment, transaction, membership, plan } = params;

  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [gatewayRow] = await db.select().from(paymentGateways).where(eq(paymentGateways.id, payment.gatewayId)).limit(1);

  // Country/city are read from the PROFILE (the real, populated source —
  // see region.ts's own doc comment for why), snapshotted by NAME at
  // issuance time — never re-joined later, so a subsequent profile edit
  // never changes a past invoice's displayed billing details.
  const [profileRow] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  let countryName: string | null = null;
  let cityName: string | null = null;
  let isoCode: string | null = null;
  if (profileRow?.countryId) {
    const [country] = await db
      .select({ name: countries.name, isoCode: countries.isoCode })
      .from(countries)
      .where(eq(countries.id, profileRow.countryId))
      .limit(1);
    countryName = country?.name ?? null;
    isoCode = country?.isoCode ?? null;
  }
  if (profileRow?.cityId) {
    const city = await referenceRepo.getCityById(profileRow.cityId);
    cityName = city?.name ?? null;
  }

  const tz = timezoneForCountry(isoCode);
  const issuedAt = new Date();
  const { taxRatePercent, taxAmountInSmallestUnit } = computeTax(payment.amountInPaise, payment.currency);

  const snapshot: InvoiceSnapshot = {
    header: HEADER,
    billedTo: {
      name: userRow?.name ?? "Unknown",
      email: userRow?.email ?? "unknown@unknown",
      mobile: userRow ? `${userRow.countryCode}${userRow.mobileNumber}` : "unknown",
      country: countryName,
      city: cityName,
    },
    membership: {
      planName: plan.name,
      planCode: plan.code,
      durationDays: plan.durationDays,
      startedAt: membership.startedAt ? membership.startedAt.toISOString() : null,
      expiresAt: membership.expiresAt ? membership.expiresAt.toISOString() : null,
    },
    payment: {
      gatewayName: gatewayRow?.name ?? "Unknown gateway",
      internalTransactionRef: transaction.transactionRef,
      gatewayTransactionId: transaction.gatewayTransactionId,
      orderReference: payment.gatewayReference,
      status: payment.status,
      paidAtUtc: payment.verifiedAt ? payment.verifiedAt.toISOString() : null,
    },
    amountTax: {
      baseAmountInSmallestUnit: payment.amountInPaise,
      discountInSmallestUnit: 0,
      taxRatePercent,
      taxAmountInSmallestUnit,
      totalInSmallestUnit: payment.amountInPaise + taxAmountInSmallestUnit,
      currency: payment.currency,
    },
    footer: FOOTER,
    invoiceNumber: "", // filled in after the unique-number insert (see issueInvoice)
    status: "ISSUED",
    issuedAtUtc: issuedAt.toISOString(),
    displayedIssuedAt: formatInvoiceTimestamp(issuedAt, tz),
    timezone: tz,
    cancellation: null,
  };
  return snapshot;
}

/**
 * Called ONLY from a payment's genuine-SUCCESS path (auto or manual —
 * see payments.service.ts). Generates the PDF once, stores it via
 * getStorageProvider() (never a second storage mechanism), and logs the
 * issuance to `invoice_logs`.
 */
export async function issueInvoice(params: IssueInvoiceParams): Promise<InvoiceRow> {
  const snapshotDraft = await buildSnapshot(params);
  const inserted = await repo.insertWithUniqueNumber({
    userId: params.userId,
    paymentId: params.payment.id,
    amountInPaise: snapshotDraft.amountTax.totalInSmallestUnit,
    snapshot: snapshotDraft, // invoiceNumber filled below once known
  });

  const finalSnapshot: InvoiceSnapshot = { ...snapshotDraft, invoiceNumber: inserted.invoiceNumber };
  const pdfBuffer = await renderInvoicePdf(finalSnapshot);
  const storage = getStorageProvider();
  const key = `invoices/${inserted.id}.pdf`;
  await storage.upload({ key, buffer: pdfBuffer, contentType: "application/pdf" });

  // Re-persist the snapshot with its now-known invoiceNumber, and record
  // the storage key it was generated under.
  const [updated] = await db
    .update(invoicesTable)
    .set({ snapshot: finalSnapshot as unknown as object, pdfStorageKey: key })
    .where(eq(invoicesTable.id, inserted.id))
    .returning();

  await repo.addLog({ invoiceId: inserted.id, action: "invoice.issued", metadata: { invoiceNumber: inserted.invoiceNumber, paymentId: params.payment.id } });

  return updated;
}

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

/** Member-only ownership check (identical error whether missing or not
 * yours — the same IDOR shape every other B6/B7/B8 module uses). Admin
 * read access is a SEPARATE, permission-gated path — see
 * getInvoiceForAdmin below — never folded into this one. */
async function loadOwnedInvoice(userId: string, invoiceId: string): Promise<InvoiceRow> {
  const invoice = await repo.findById(invoiceId);
  if (!invoice || invoice.userId !== userId) {
    throw new AuthorizationError("You do not have permission to access this invoice.");
  }
  return invoice;
}

export async function listMyInvoices(ctx: AuthContext): Promise<InvoiceRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listByUser(userId);
}

export async function getMyInvoice(ctx: AuthContext, invoiceId: string): Promise<InvoiceRow> {
  const userId = requireMemberSubject(ctx);
  return loadOwnedInvoice(userId, invoiceId);
}

export async function downloadInvoicePdf(ctx: AuthContext, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
  const userId = requireMemberSubject(ctx);
  const invoice = await loadOwnedInvoice(userId, invoiceId);
  if (!invoice.pdfStorageKey) {
    throw new NotFoundError("This invoice's PDF has not been generated yet.");
  }
  const stored = await getStorageProvider().read(invoice.pdfStorageKey);
  if (!stored) throw new NotFoundError("Invoice PDF not found in storage.");
  return { buffer: stored.buffer, filename: `${invoice.invoiceNumber}.pdf` };
}

/**
 * B12 QA gap-fix: re-deliver an already-issued invoice's notification
 * (reusing the exact same `notify()`/EMAIL-provider infrastructure every
 * other B7/B8 notification already goes through — no second delivery
 * mechanism invented). This does NOT regenerate the PDF or mutate the
 * invoice in any way (see `regenerateInvoicePdf` for that, admin-only,
 * unaffected by this addition) — it only re-sends the "your invoice is
 * ready, here's how to get it" notification, for a member who lost the
 * original email/notification or simply wants it re-sent.
 *
 * Member-only, owner-only (identical IDOR shape to every other invoice
 * action in this module). A VOIDed invoice cannot be resent (409) — a
 * cancelled invoice has nothing legitimate to re-deliver. Best-effort:
 * `notify()` itself never throws (see notifications.service.ts's own
 * top-of-file comment) — a resend "succeeds" (200) whether or not a real
 * EMAIL/WHATSAPP vendor is actually configured in this environment
 * (there isn't one — see BACKEND.md's B7 known-limitations), matching
 * this codebase's universal "notify best-effort, never block the caller"
 * convention. The rate limit (invoices.controller.ts) is the actual
 * abuse control, not the notify() outcome.
 */
export async function resendInvoice(ctx: AuthContext, invoiceId: string): Promise<InvoiceRow> {
  const userId = requireMemberSubject(ctx);
  const invoice = await loadOwnedInvoice(userId, invoiceId);
  if (invoice.status === "VOID") {
    throw new ValidationError("This invoice has been cancelled and cannot be resent.");
  }

  await notify({
    userId,
    channel: "EMAIL",
    title: `Invoice ${invoice.invoiceNumber} resent`,
    body: `Your invoice ${invoice.invoiceNumber} is available to download from your account (GET /api/v1/invoices/${invoice.id}/download).`,
    // No dedupeKey: a resend is a deliberate, repeatable member action
    // (unlike e.g. "membership activated", which should only ever notify
    // once) — see invoices.controller.ts's rate limit for the actual
    // abuse control on repeated resends.
  });

  await repo.addLog({ invoiceId: invoice.id, action: "invoice.resent", metadata: { requestedByUserId: userId } });
  await record({
    actorType: "USER",
    actorId: userId,
    action: "invoice.resent",
    entityType: "invoice",
    entityId: invoice.id,
  });

  return invoice;
}

export interface VoidInvoiceInput {
  reason: string;
}

/** Admin-only. Preserves the invoice's own number and all financial data
 * — only status/cancelledAt/cancellationReason change; the stored PDF is
 * never touched or regenerated (see this module's top-of-file comment). */
export async function cancelInvoice(ctx: AuthContext, invoiceId: string, input: VoidInvoiceInput): Promise<InvoiceRow> {
  await requirePermission(ctx, ADMIN_PERMISSION);
  if (!input.reason || !input.reason.trim()) {
    throw new ValidationError("A cancellation reason is required.");
  }
  const invoice = await repo.findById(invoiceId);
  if (!invoice) throw new NotFoundError("Invoice not found.");
  if (invoice.status === "VOID") return invoice; // idempotent

  const updated = await repo.voidInvoice(invoiceId, input.reason.trim());
  await repo.addLog({
    invoiceId,
    action: "invoice.voided",
    actorAdminId: ctx.subject.id,
    metadata: { reason: input.reason.trim() },
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "invoice.voided",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { reason: input.reason.trim() },
  });
  return updated;
}

/**
 * Admin-only technical regeneration (e.g. a rendering bug fix) — the
 * invoice NUMBER and every financial figure are preserved exactly (read
 * straight back out of the already-stored snapshot, never recomputed),
 * only the PDF bytes are re-rendered and uploaded under a NEW storage
 * key; the old key is retained in the log entry, never deleted (invoice
 * history is never destroyed).
 */
export async function regenerateInvoicePdf(ctx: AuthContext, invoiceId: string, reason: string): Promise<InvoiceRow> {
  await requirePermission(ctx, ADMIN_PERMISSION);
  if (!reason || !reason.trim()) {
    throw new ValidationError("A reason is required to regenerate an invoice PDF.");
  }
  const invoice = await repo.findById(invoiceId);
  if (!invoice) throw new NotFoundError("Invoice not found.");

  const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
  const pdfBuffer = await renderInvoicePdf(snapshot);
  const storage = getStorageProvider();
  const oldKey = invoice.pdfStorageKey;
  const newKey = `invoices/${invoice.id}-regen-${Date.now()}.pdf`;
  await storage.upload({ key: newKey, buffer: pdfBuffer, contentType: "application/pdf" });
  const updated = await repo.setPdfStorageKey(invoiceId, newKey);

  await repo.addLog({
    invoiceId,
    action: "invoice.pdf_regenerated",
    actorAdminId: ctx.subject.id,
    metadata: { reason: reason.trim(), oldPdfStorageKey: oldKey, newPdfStorageKey: newKey },
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "invoice.pdf_regenerated",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { reason: reason.trim() },
  });

  return updated;
}

export async function getInvoiceForAdmin(ctx: AuthContext, invoiceId: string): Promise<InvoiceRow> {
  await requirePermission(ctx, ADMIN_PERMISSION);
  const invoice = await repo.findById(invoiceId);
  if (!invoice) throw new NotFoundError("Invoice not found.");
  return invoice;
}
