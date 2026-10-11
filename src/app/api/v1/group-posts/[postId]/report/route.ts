import { withErrorHandling } from "@/server/middleware/error-handler";
import { reportPostHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const POST = withErrorHandling((req, ctx) => reportPostHandler(req, ctx.params as { postId: string }));
