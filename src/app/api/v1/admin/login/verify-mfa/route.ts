import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminVerifyMfaHandler } from "@/server/modules/admin/admin.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => adminVerifyMfaHandler(req));
