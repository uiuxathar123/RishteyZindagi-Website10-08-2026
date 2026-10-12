import { withErrorHandling } from "@/server/middleware/error-handler";
import { phonepeWebhookHandler } from "@/server/modules/payments/webhooks.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => phonepeWebhookHandler(req));
