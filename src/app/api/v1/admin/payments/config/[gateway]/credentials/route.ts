import { withErrorHandling } from "@/server/middleware/error-handler";
import { putCredentialsHandler } from "@/server/modules/payments/payment-config.controller";

export const dynamic = "force-dynamic";

export const PUT = withErrorHandling((req, ctx) => putCredentialsHandler(req, ctx.params as { gateway: string }));
