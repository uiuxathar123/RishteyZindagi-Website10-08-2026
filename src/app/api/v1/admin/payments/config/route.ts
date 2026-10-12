import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPaymentConfigHandler, patchPaymentConfigHandler } from "@/server/modules/payments/payment-config.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getPaymentConfigHandler(req));
export const PATCH = withErrorHandling((req) => patchPaymentConfigHandler(req));
