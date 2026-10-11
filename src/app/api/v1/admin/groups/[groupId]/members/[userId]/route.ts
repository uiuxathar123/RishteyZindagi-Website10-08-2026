import { withErrorHandling } from "@/server/middleware/error-handler";
import { setMemberRemovedHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const PATCH = withErrorHandling((req, ctx) => setMemberRemovedHandler(req, ctx.params as { groupId: string; userId: string }));
