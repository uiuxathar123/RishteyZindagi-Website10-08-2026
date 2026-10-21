import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminSearchMembersHandler } from "@/server/modules/matchmaking/introductions.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminSearchMembersHandler(req));
