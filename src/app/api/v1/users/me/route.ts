import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMeHandler } from "@/server/modules/users/users.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getMeHandler(req));
