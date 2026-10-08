import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyMembershipHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getMyMembershipHandler(req));
