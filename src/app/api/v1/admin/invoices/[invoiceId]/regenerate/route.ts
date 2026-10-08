import { withErrorHandling } from "@/server/middleware/error-handler";
import { regenerateInvoicePdfHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => regenerateInvoicePdfHandler(req, ctx.params as { invoiceId: string }));
