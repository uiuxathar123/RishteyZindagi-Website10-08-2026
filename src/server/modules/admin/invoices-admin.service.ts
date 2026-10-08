/**
 * B9: admin invoice search/filter/list. Reuses the existing
 * `payments.review` permission — the same payment/invoice admin surface
 * B8 already gates single-invoice cancel/regenerate behind (see
 * invoices.service.ts's ADMIN_PERMISSION) — rather than adding a new
 * permission, since this is the same capability class (view/administer
 * billing records), just with search instead of by-id lookup.
 */
import { ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./invoices-admin.repository";
import type { AdminInvoiceSearchRow } from "./invoices-admin.repository";

const PERMISSION = "payments.review";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface SearchInvoicesInput {
  invoiceNumber?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  planId?: string;
  amountMin?: number;
  amountMax?: number;
  paymentStatus?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  gatewayId?: string;
  currency?: string;
  transactionId?: string;
  page?: number;
  pageSize?: number;
}

export interface InvoiceSearchView {
  id: string;
  invoiceNumber: string;
  userId: string;
  amountInPaise: number;
  status: string;
  issuedAt: string;
  cancelledAt: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  currency: string | null;
  gatewayId: string | null;
  gatewayName: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  transactionRef: string | null;
  gatewayTransactionId: string | null;
}

function toSearchView(row: AdminInvoiceSearchRow): InvoiceSearchView {
  return {
    ...row,
    issuedAt: row.issuedAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
  };
}

export interface InvoicesPage {
  items: InvoiceSearchView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function searchInvoicesForAdmin(ctx: AuthContext, input: SearchInvoicesInput): Promise<InvoicesPage> {
  await requirePermission(ctx, PERMISSION);

  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
  const dateTo = input.dateTo ? new Date(input.dateTo) : undefined;
  if (dateFrom && Number.isNaN(dateFrom.getTime())) throw new ValidationError("Invalid dateFrom.");
  if (dateTo && Number.isNaN(dateTo.getTime())) throw new ValidationError("Invalid dateTo.");
  if (input.amountMin !== undefined && input.amountMax !== undefined && input.amountMin > input.amountMax) {
    throw new ValidationError("amountMin cannot be greater than amountMax.");
  }

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const { items, total } = await repo.searchInvoices(
    {
      invoiceNumber: input.invoiceNumber,
      userId: input.userId,
      dateFrom,
      dateTo,
      planId: input.planId,
      amountMin: input.amountMin,
      amountMax: input.amountMax,
      paymentStatus: input.paymentStatus,
      gatewayId: input.gatewayId,
      currency: input.currency,
      transactionId: input.transactionId,
    },
    page,
    pageSize
  );

  return { items: items.map(toSearchView), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
