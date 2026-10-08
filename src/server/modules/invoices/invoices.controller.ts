/**
 * B8: HTTP layer for invoices — member listing/detail/PDF download, plus
 * admin cancel (VOID) and technical PDF regeneration.
 */
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as invoicesService from "./invoices.service";
import * as dto from "./invoices.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const invoiceParamsSchema = z.object({ invoiceId: uuidField });

export async function listMyInvoicesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await invoicesService.listMyInvoices(ctx);
  return ok({ invoices: rows.map(dto.toSummaryView) });
}

export async function getMyInvoiceHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const invoice = await invoicesService.getMyInvoice(ctx, invoiceId);
  return ok({ invoice: dto.toDetailView(invoice) });
}

export async function downloadMyInvoiceHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const { buffer, filename } = await invoicesService.downloadInvoicePdf(ctx, invoiceId);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

const reasonSchema = z.object({ reason: z.string().trim().min(1, "A reason is required.") }).strict();

/** B12 QA gap-fix: re-send an already-issued invoice's notification —
 * see invoices.service.ts's resendInvoice doc comment. Rate-limited
 * (5/hour per member) so it can't be used to hammer the notification
 * provider or generate unbounded audit/log noise. */
export async function resendInvoiceHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`invoice-resend:${ctx.subject.id}`, 5, 60 * 60_000);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const invoice = await invoicesService.resendInvoice(ctx, invoiceId);
  return ok({ invoice: dto.toDetailView(invoice) }, "Invoice resent.");
}

export async function cancelInvoiceHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`invoice-cancel:${ctx.subject.id}`, 20, 60_000);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const body = await parseJsonBody(req, reasonSchema);
  const invoice = await invoicesService.cancelInvoice(ctx, invoiceId, body);
  return ok({ invoice: dto.toDetailView(invoice) }, "Invoice cancelled.");
}

export async function regenerateInvoicePdfHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`invoice-regenerate:${ctx.subject.id}`, 10, 60_000);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const body = await parseJsonBody(req, reasonSchema);
  const invoice = await invoicesService.regenerateInvoicePdf(ctx, invoiceId, body.reason);
  return ok({ invoice: dto.toDetailView(invoice) }, "Invoice PDF regenerated.");
}

export async function getInvoiceForAdminHandler(req: NextRequest, params: { invoiceId: string }) {
  const ctx = await authenticate(req);
  const { invoiceId } = parseParams(invoiceParamsSchema, params);
  const invoice = await invoicesService.getInvoiceForAdmin(ctx, invoiceId);
  return ok({ invoice: dto.toDetailView(invoice) });
}
