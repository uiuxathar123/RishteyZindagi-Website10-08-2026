import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMyPaymentsHandler } from "@/server/modules/payments/payments.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMyPaymentsHandler(req));
