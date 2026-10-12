import { withErrorHandling } from "@/server/middleware/error-handler";
import { razorpayWebhookHandler } from "@/server/modules/payments/webhooks.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => razorpayWebhookHandler(req));
