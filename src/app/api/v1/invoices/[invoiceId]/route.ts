import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyInvoiceHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => getMyInvoiceHandler(req, ctx.params as { invoiceId: string }));
