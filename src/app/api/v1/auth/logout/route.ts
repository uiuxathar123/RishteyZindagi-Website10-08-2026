import { withErrorHandling } from "@/server/middleware/error-handler";
import { logoutHandler } from "@/server/modules/auth/auth.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => logoutHandler(req));
