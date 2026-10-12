import { withErrorHandling } from "@/server/middleware/error-handler";
import { listDeletionsHandler } from "@/server/modules/account/account-deletion.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listDeletionsHandler(req));
