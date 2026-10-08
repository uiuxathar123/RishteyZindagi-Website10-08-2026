import { withErrorHandling } from "@/server/middleware/error-handler";
import { listPaymentsForAdminHandler } from "@/server/modules/payments/payments.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listPaymentsForAdminHandler(req));
