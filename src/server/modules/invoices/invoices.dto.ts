/**
 * B8: response shaping for invoices — a summary view for listing, a full
 * view (including the stored snapshot) for a single invoice.
 */
import type { InvoiceRow } from "./invoices.repository";

export interface InvoiceSummaryView {
  id: string;
  invoiceNumber: string;
  amountInPaise: number;
  status: "ISSUED" | "PAID" | "VOID";
  issuedAt: string;
  cancelledAt: string | null;
}

export function toSummaryView(row: InvoiceRow): InvoiceSummaryView {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    amountInPaise: row.amountInPaise,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
  };
}

export interface InvoiceDetailView extends InvoiceSummaryView {
  paymentId: string | null;
  cancellationReason: string | null;
  snapshot: unknown;
}

export function toDetailView(row: InvoiceRow): InvoiceDetailView {
  return {
    ...toSummaryView(row),
    paymentId: row.paymentId,
    cancellationReason: row.cancellationReason,
    snapshot: row.snapshot,
  };
}
