import { withErrorHandling } from "@/server/middleware/error-handler";
import { getInvoiceForAdminHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => getInvoiceForAdminHandler(req, ctx.params as { invoiceId: string }));
