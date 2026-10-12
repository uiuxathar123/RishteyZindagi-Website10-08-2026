import { withErrorHandling } from "@/server/middleware/error-handler";
import { listSessionsHandler, revokeOtherSessionsHandler } from "@/server/modules/account/member-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listSessionsHandler(req));
/** Signs out every device except the one making the request. */
export const DELETE = withErrorHandling((req) => revokeOtherSessionsHandler(req));
