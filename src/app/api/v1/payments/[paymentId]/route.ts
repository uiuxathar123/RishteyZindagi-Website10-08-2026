import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyPaymentHandler } from "@/server/modules/payments/payments.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => getMyPaymentHandler(req, ctx.params as { paymentId: string }));
