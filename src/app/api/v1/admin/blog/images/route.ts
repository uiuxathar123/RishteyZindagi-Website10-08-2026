import { withErrorHandling } from "@/server/middleware/error-handler";
import { uploadImageHandler } from "@/server/modules/blog/blog.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => uploadImageHandler(req));
