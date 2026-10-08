import { withErrorHandling } from "@/server/middleware/error-handler";
import { unshortlistUserHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) =>
  unshortlistUserHandler(req, ctx.params as { targetUserId: string })
);
