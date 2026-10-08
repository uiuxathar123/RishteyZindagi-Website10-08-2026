import { withErrorHandling } from "@/server/middleware/error-handler";
import { unlikeUserHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) =>
  unlikeUserHandler(req, ctx.params as { toUserId: string })
);
