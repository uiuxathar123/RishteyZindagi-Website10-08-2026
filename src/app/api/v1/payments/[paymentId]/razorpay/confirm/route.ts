import { withErrorHandling } from "@/server/middleware/error-handler";
import { confirmRazorpayHandler } from "@/server/modules/payments/razorpay-confirm.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => confirmRazorpayHandler(req, ctx.params as { paymentId: string }));
