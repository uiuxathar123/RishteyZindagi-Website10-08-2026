import { withErrorHandling } from "@/server/middleware/error-handler";
import { listGatewaysHandler } from "@/server/modules/payments/gateways.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listGatewaysHandler(req));
