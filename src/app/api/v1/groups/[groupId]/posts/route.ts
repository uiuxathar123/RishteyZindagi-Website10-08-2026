import { withErrorHandling } from "@/server/middleware/error-handler";
import { createPostHandler, listPostsHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const GET = withErrorHandling((req, ctx) => listPostsHandler(req, ctx.params as { groupId: string }));
export const POST = withErrorHandling((req, ctx) => createPostHandler(req, ctx.params as { groupId: string }));
