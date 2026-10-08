import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMyMembershipHistoryHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMyMembershipHistoryHandler(req));
