import { withErrorHandling } from "@/server/middleware/error-handler";
import { listGroupsHandler } from "@/server/modules/groups/groups.controller";

export const dynamic = "force-dynamic";
export const GET = withErrorHandling((req) => listGroupsHandler(req));
