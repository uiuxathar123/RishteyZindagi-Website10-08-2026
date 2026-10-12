import { withErrorHandling } from "@/server/middleware/error-handler";
import { moderationViewHandler } from "@/server/modules/moderation/moderation.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => moderationViewHandler(req, ctx.params as { userId: string }));
