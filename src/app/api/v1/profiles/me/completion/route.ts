import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyProfileCompletionHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getMyProfileCompletionHandler(req));
