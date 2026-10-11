import { withErrorHandling } from "@/server/middleware/error-handler";
import { getGroupHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const GET = withErrorHandling((req, ctx) => getGroupHandler(req, ctx.params as { groupId: string }));
