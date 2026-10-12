import { withErrorHandling } from "@/server/middleware/error-handler";
import { revokeSessionHandler } from "@/server/modules/account/member-settings.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) => revokeSessionHandler(req, ctx.params as { sessionId: string }));
