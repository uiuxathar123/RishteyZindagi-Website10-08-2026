import { withErrorHandling } from "@/server/middleware/error-handler";
import { verifyPaymentHandler } from "@/server/modules/payments/payments.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => verifyPaymentHandler(req, ctx.params as { paymentId: string }));
