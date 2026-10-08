import { withErrorHandling } from "@/server/middleware/error-handler";
import { activateGatewayHandler } from "@/server/modules/payments/gateways.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => activateGatewayHandler(req, ctx.params as { gatewayId: string }));
