import { withErrorHandling } from "@/server/middleware/error-handler";
import { getSupportContactAdminHandler, patchSupportContactHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getSupportContactAdminHandler(req));
export const PATCH = withErrorHandling((req) => patchSupportContactHandler(req));
