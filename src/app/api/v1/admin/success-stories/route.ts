import { withErrorHandling } from "@/server/middleware/error-handler";
import { listStoriesAdminHandler, createStoryHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listStoriesAdminHandler(req));
export const POST = withErrorHandling((req) => createStoryHandler(req));
