import { withErrorHandling } from "@/server/middleware/error-handler";
import { createCommunityHandler, listCommunitiesHandler } from "@/server/modules/admin/communities-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listCommunitiesHandler(req));
export const POST = withErrorHandling((req) => createCommunityHandler(req));
