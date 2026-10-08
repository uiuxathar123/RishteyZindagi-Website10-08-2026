import { withErrorHandling } from "@/server/middleware/error-handler";
import { deactivateGatewayHandler } from "@/server/modules/payments/gateways.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => deactivateGatewayHandler(req, ctx.params as { gatewayId: string }));
