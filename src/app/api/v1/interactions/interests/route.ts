import { withErrorHandling } from "@/server/middleware/error-handler";
import { sendInterestHandler, listInterestsHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => sendInterestHandler(req));
export const GET = withErrorHandling((req) => listInterestsHandler(req));
