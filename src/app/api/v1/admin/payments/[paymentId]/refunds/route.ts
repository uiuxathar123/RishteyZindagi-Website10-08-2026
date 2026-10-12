import { withErrorHandling } from "@/server/middleware/error-handler";
import { createRefundHandler, listRefundsHandler } from "@/server/modules/payments/refunds.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => listRefundsHandler(req, ctx.params as { paymentId: string }));
export const POST = withErrorHandling((req, ctx) => createRefundHandler(req, ctx.params as { paymentId: string }));
