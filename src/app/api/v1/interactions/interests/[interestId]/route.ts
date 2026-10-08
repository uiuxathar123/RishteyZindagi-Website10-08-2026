import { withErrorHandling } from "@/server/middleware/error-handler";
import { respondToInterestHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) =>
  respondToInterestHandler(req, ctx.params as { interestId: string })
);
