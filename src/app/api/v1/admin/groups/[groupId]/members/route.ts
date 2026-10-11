import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMembersAdminHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const GET = withErrorHandling((req, ctx) => listMembersAdminHandler(req, ctx.params as { groupId: string }));
