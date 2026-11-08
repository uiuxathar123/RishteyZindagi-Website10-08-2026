import { withErrorHandling } from "@/server/middleware/error-handler";
import { createPostHandler, listPostsAdminHandler } from "@/server/modules/blog/blog.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listPostsAdminHandler(req));
export const POST = withErrorHandling((req) => createPostHandler(req));
