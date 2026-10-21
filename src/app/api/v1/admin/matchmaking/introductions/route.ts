import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminListIntroductionsHandler, adminCreateIntroductionHandler } from "@/server/modules/matchmaking/introductions.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminListIntroductionsHandler(req));
export const POST = withErrorHandling((req) => adminCreateIntroductionHandler(req));
