import { withErrorHandling } from "@/server/middleware/error-handler";
import { cancelInvoiceHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => cancelInvoiceHandler(req, ctx.params as { invoiceId: string }));
