import { withErrorHandling } from "@/server/middleware/error-handler";
import { setPostHiddenHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const PATCH = withErrorHandling((req, ctx) => setPostHiddenHandler(req, ctx.params as { postId: string }));
