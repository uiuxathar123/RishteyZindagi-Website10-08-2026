import { withErrorHandling } from "@/server/middleware/error-handler";
import { downloadMyInvoiceHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => downloadMyInvoiceHandler(req, ctx.params as { invoiceId: string }));
