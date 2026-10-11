import { withErrorHandling } from "@/server/middleware/error-handler";
import { deletePostHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const DELETE = withErrorHandling((req, ctx) => deletePostHandler(req, ctx.params as { postId: string }));
