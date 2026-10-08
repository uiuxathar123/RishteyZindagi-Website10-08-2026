import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMyInvoicesHandler } from "@/server/modules/invoices/invoices.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMyInvoicesHandler(req));
