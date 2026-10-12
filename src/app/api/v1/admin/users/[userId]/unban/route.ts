import { withErrorHandling } from "@/server/middleware/error-handler";
import { unbanHandler } from "@/server/modules/moderation/moderation.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => unbanHandler(req, ctx.params as { userId: string }));
