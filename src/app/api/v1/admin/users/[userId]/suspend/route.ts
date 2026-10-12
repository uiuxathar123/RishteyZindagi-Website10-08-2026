import { withErrorHandling } from "@/server/middleware/error-handler";
import { suspendHandler } from "@/server/modules/moderation/moderation.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => suspendHandler(req, ctx.params as { userId: string }));
