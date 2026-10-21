import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminListInvitationsHandler, adminInviteHandler } from "@/server/modules/matchmaking/invitations.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminListInvitationsHandler(req));
export const POST = withErrorHandling((req) => adminInviteHandler(req));
