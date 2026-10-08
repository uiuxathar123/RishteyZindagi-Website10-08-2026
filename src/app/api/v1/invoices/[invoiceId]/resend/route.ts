import { withErrorHandling } from "@/server/middleware/error-handler";
import { resendInvoiceHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => resendInvoiceHandler(req, ctx.params as { invoiceId: string }));
