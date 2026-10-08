import { withErrorHandling } from "@/server/middleware/error-handler";
import { renewMembershipHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => renewMembershipHandler(req));
