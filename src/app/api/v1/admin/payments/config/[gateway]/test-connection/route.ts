import { withErrorHandling } from "@/server/middleware/error-handler";
import { testConnectionHandler } from "@/server/modules/payments/payment-config.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => testConnectionHandler(req, ctx.params as { gateway: string }));
