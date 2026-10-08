import { withErrorHandling } from "@/server/middleware/error-handler";
import { unblockUserHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) =>
  unblockUserHandler(req, ctx.params as { targetUserId: string })
);
