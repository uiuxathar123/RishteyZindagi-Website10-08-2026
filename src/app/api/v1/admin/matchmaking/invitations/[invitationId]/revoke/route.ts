import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminRevokeInvitationHandler } from "@/server/modules/matchmaking/invitations.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => adminRevokeInvitationHandler(req, ctx.params as Record<string, string>));
