import { withErrorHandling } from "@/server/middleware/error-handler";
import { registerPushTokenHandler, listPushTokensHandler } from "@/server/modules/devices/push-tokens.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => registerPushTokenHandler(req));
export const GET = withErrorHandling((req) => listPushTokensHandler(req));
