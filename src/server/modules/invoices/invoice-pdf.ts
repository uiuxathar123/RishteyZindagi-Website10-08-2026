/**
 * B8: invoice PDF rendering — pdfkit (pure-Node, no browser/headless-
 * Chrome dependency; installs cleanly from the npm registry this
 * sandbox can reach — see BACKEND.md's B8 section for the library
 * choice note, mirroring schema.ts's own Drizzle-over-Prisma reasoning).
 *
 * Renders ONLY from a stored `InvoiceSnapshot` (see invoices.service.ts)
 * — never from a live join of `users`/`profiles`/`memberships`/`payments`,
 * so a regenerated PDF is always byte-identical in CONTENT to the one
 * issued originally, even if the user's profile or the plan's price has
 * since changed (see schema.ts's `invoices.snapshot` comment).
 *
 * Placeholder legal content (documented plainly, not hidden): no real
 * company legal name/address/GST registration exists anywhere in this
 * project's data — the header/footer text below is clearly-labeled
 * placeholder copy, not researched real-world legal text. See
 * BACKEND.md's B8 section.
 */
import PDFDocument from "pdfkit";

export interface InvoiceSnapshot {
  header: {
    companyName: string;
    companyAddress: string;
    companyContact: string;
    gstPlaceholder: string;
  };
  billedTo: {
    name: string;
    email: string;
    mobile: string;
    country: string | null;
    city: string | null;
  };
  /** Present on membership invoices (every invoice issued before Personal Matchmaking existed has it). */
  membership?: {
    planName: string;
    planCode: string;
    durationDays: number;
    startedAt: string | null;
    expiresAt: string | null;
  };
  /** Present on service invoices (Personal Matchmaking), which include an access period instead of a plan. */
  service?: {
    name: string;
    code: string;
    includedAccessDays: number;
    accessFrom: string | null;
    accessUntil: string | null;
  };
  payment: {
    gatewayName: string;
    internalTransactionRef: string;
    gatewayTransactionId: string | null;
    orderReference: string | null;
    status: string;
    paidAtUtc: string | null;
  };
  amountTax: {
    baseAmountInSmallestUnit: number;
    discountInSmallestUnit: number;
    taxRatePercent: number;
    taxAmountInSmallestUnit: number;
    totalInSmallestUnit: number;
    currency: string;
  };
  footer: {
    supportText: string;
    termsText: string;
    privacyText: string;
    refundCancellationText: string;
    legalText: string;
  };
  invoiceNumber: string;
  status: "ISSUED" | "PAID" | "VOID";
  issuedAtUtc: string;
  displayedIssuedAt: string;
  timezone: string;
  cancellation: { cancelledAtUtc: string; reason: string } | null;
}

function formatAmount(smallestUnit: number, currency: string): string {
  const major = smallestUnit / 100;
  const symbol = currency === "INR" ? "Rs." : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${major.toFixed(2)}`;
}

export function renderInvoicePdf(snapshot: InvoiceSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // --- Header ------------------------------------------------------
    doc.fontSize(18).text(snapshot.header.companyName, { align: "left" });
    doc.fontSize(9).fillColor("#555555");
    doc.text(snapshot.header.companyAddress);
    doc.text(snapshot.header.companyContact);
    doc.text(snapshot.header.gstPlaceholder);
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    doc.fontSize(14).text(`INVOICE  ${snapshot.invoiceNumber}`, { align: "right" });
    doc.fontSize(9).fillColor("#555555").text(`Status: ${snapshot.status}`, { align: "right" });
    doc.text(`Issued: ${snapshot.displayedIssuedAt} (${snapshot.timezone})`, { align: "right" });
    doc.fillColor("#000000");
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // --- Billed To -----------------------------------------------------
    doc.fontSize(11).text("Billed To", { underline: true });
    doc.fontSize(10);
    doc.text(snapshot.billedTo.name);
    doc.text(snapshot.billedTo.email);
    doc.text(snapshot.billedTo.mobile);
    const location = [snapshot.billedTo.city, snapshot.billedTo.country].filter(Boolean).join(", ");
    if (location) doc.text(location);
    doc.moveDown(1);

    // --- Membership or service ------------------------------------------
    if (snapshot.membership) {
      doc.fontSize(11).text("Membership", { underline: true });
      doc.fontSize(10);
      doc.text(`Plan: ${snapshot.membership.planName} (${snapshot.membership.planCode})`);
      doc.text(`Duration: ${snapshot.membership.durationDays} days`);
      if (snapshot.membership.startedAt) doc.text(`Start: ${snapshot.membership.startedAt}`);
      if (snapshot.membership.expiresAt) doc.text(`Expiry: ${snapshot.membership.expiresAt}`);
      doc.moveDown(1);
    }
    if (snapshot.service) {
      doc.fontSize(11).text("Service", { underline: true });
      doc.fontSize(10);
      doc.text(`Service: ${snapshot.service.name} (${snapshot.service.code})`);
      doc.text(`Included member access: ${snapshot.service.includedAccessDays} days`);
      if (snapshot.service.accessFrom) doc.text(`Access from: ${snapshot.service.accessFrom}`);
      if (snapshot.service.accessUntil) doc.text(`Access until: ${snapshot.service.accessUntil}`);
      doc.moveDown(1);
    }

    // --- Payment -----------------------------------------------------
    doc.fontSize(11).text("Payment", { underline: true });
    doc.fontSize(10);
    doc.text(`Gateway: ${snapshot.payment.gatewayName}`);
    doc.text(`Internal transaction id: ${snapshot.payment.internalTransactionRef}`);
    doc.text(`Order/reference id: ${snapshot.payment.orderReference ?? "N/A"}`);
    doc.text(`Gateway transaction id: ${snapshot.payment.gatewayTransactionId ?? "N/A"}`);
    doc.text(`Payment status: ${snapshot.payment.status}`);
    if (snapshot.payment.paidAtUtc) doc.text(`Paid at (UTC): ${snapshot.payment.paidAtUtc}`);
    doc.moveDown(1);

    // --- Amount / Tax ------------------------------------------------
    doc.fontSize(11).text("Amount", { underline: true });
    doc.fontSize(10);
    const { amountTax } = snapshot;
    doc.text(`Base amount: ${formatAmount(amountTax.baseAmountInSmallestUnit, amountTax.currency)}`);
    doc.text(`Discount: ${formatAmount(amountTax.discountInSmallestUnit, amountTax.currency)}`);
    doc.text(
      amountTax.currency === "INR"
        ? `GST (${amountTax.taxRatePercent}% — placeholder rate, see footer): ${formatAmount(amountTax.taxAmountInSmallestUnit, amountTax.currency)}`
        : `Tax (0%): ${formatAmount(amountTax.taxAmountInSmallestUnit, amountTax.currency)}`
    );
    doc.fontSize(11).text(`Total: ${formatAmount(amountTax.totalInSmallestUnit, amountTax.currency)}`, { underline: false });
    doc.moveDown(1);

    if (snapshot.cancellation) {
      doc.fontSize(11).fillColor("#b00000").text("Cancelled", { underline: true });
      doc.fontSize(10).text(`Cancelled at (UTC): ${snapshot.cancellation.cancelledAtUtc}`);
      doc.text(`Reason: ${snapshot.cancellation.reason}`);
      doc.fillColor("#000000");
      doc.moveDown(1);
    }

    // --- Footer --------------------------------------------------------
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor("#555555");
    doc.text(snapshot.footer.supportText);
    doc.text(snapshot.footer.termsText);
    doc.text(snapshot.footer.privacyText);
    doc.text(snapshot.footer.refundCancellationText);
    doc.text(snapshot.footer.legalText);
    doc.fillColor("#000000");

    doc.end();
  });
}
