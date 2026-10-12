import { withErrorHandling } from "@/server/middleware/error-handler";
import { banHandler } from "@/server/modules/moderation/moderation.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => banHandler(req, ctx.params as { userId: string }));
