import { withErrorHandling } from "@/server/middleware/error-handler";
import { joinGroupHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const POST = withErrorHandling((req, ctx) => joinGroupHandler(req, ctx.params as { groupId: string }));
