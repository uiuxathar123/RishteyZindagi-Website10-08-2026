import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateGatewayHandler } from "@/server/modules/payments/gateways.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updateGatewayHandler(req, ctx.params as { gatewayId: string }));
