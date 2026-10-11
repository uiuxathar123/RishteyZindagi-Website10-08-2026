import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateStoryHandler, deleteStoryHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updateStoryHandler(req, ctx.params as { storyId: string }));
export const DELETE = withErrorHandling((req, ctx) => deleteStoryHandler(req, ctx.params as { storyId: string }));
