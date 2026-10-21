import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminIntroductionCandidatesHandler } from "@/server/modules/matchmaking/introductions.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminIntroductionCandidatesHandler(req));
