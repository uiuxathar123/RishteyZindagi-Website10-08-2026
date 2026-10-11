import { withErrorHandling } from "@/server/middleware/error-handler";
import { leaveGroupHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const POST = withErrorHandling((req, ctx) => leaveGroupHandler(req, ctx.params as { groupId: string }));
