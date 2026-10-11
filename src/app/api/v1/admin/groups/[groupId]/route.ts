import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateGroupHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const PATCH = withErrorHandling((req, ctx) => updateGroupHandler(req, ctx.params as { groupId: string }));
