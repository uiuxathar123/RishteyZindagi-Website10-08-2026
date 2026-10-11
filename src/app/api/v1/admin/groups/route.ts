import { withErrorHandling } from "@/server/middleware/error-handler";
import { createGroupHandler, listGroupsAdminHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const GET = withErrorHandling((req) => listGroupsAdminHandler(req));
export const POST = withErrorHandling((req) => createGroupHandler(req));
