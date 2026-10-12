import { withErrorHandling } from "@/server/middleware/error-handler";
import { resumeRazorpayHandler } from "@/server/modules/payments/razorpay-resume.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => resumeRazorpayHandler(req, ctx.params as { paymentId: string }));
