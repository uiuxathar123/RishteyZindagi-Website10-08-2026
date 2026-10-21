import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminDirectoryHandler } from "@/server/modules/matchmaking/invitations.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminDirectoryHandler(req));
