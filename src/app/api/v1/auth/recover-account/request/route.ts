import { withErrorHandling } from "@/server/middleware/error-handler";
import { recoverRequestHandler } from "@/server/modules/account/account-deletion.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => recoverRequestHandler(req));
