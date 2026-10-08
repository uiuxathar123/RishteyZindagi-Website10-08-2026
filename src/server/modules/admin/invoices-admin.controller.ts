/**
 * B9: HTTP layer for the admin invoice search/filter/list endpoint.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as invoicesAdminService from "./invoices-admin.service";

const uuidField = z.string().uuid();

const searchInvoicesQuerySchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  userId: uuidField.optional(),
  dateFrom: z.string().datetime().optional().or(z.string().date().optional()),
  dateTo: z.string().datetime().optional().or(z.string().date().optional()),
  planId: uuidField.optional(),
  amountMin: z.coerce.number().int().min(0).optional(),
  amountMax: z.coerce.number().int().min(0).optional(),
  paymentStatus: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
  gatewayId: uuidField.optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  transactionId: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function searchInvoicesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = searchInvoicesQuerySchema.safeParse({
    invoiceNumber: sp.get("invoiceNumber") ?? undefined,
    userId: sp.get("userId") ?? undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    planId: sp.get("planId") ?? undefined,
    amountMin: sp.get("amountMin") ?? undefined,
    amountMax: sp.get("amountMax") ?? undefined,
    paymentStatus: sp.get("paymentStatus") ?? undefined,
    gatewayId: sp.get("gatewayId") ?? undefined,
    currency: sp.get("currency") ?? undefined,
    transactionId: sp.get("transactionId") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const page = await invoicesAdminService.searchInvoicesForAdmin(ctx, parsed.data);
  return ok(page);
}
