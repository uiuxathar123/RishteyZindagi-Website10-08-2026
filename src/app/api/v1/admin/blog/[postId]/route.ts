import { withErrorHandling } from "@/server/middleware/error-handler";
import { deletePostHandler, updatePostHandler } from "@/server/modules/blog/blog.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updatePostHandler(req, ctx.params as { postId: string }));
export const DELETE = withErrorHandling((req, ctx) => deletePostHandler(req, ctx.params as { postId: string }));
