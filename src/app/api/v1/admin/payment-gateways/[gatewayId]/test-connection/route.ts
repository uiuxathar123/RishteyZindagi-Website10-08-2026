import { withErrorHandling } from "@/server/middleware/error-handler";
import { testGatewayConnectionHandler } from "@/server/modules/payments/gateways.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => testGatewayConnectionHandler(req, ctx.params as { gatewayId: string }));
