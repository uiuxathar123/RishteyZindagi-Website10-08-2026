import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminLoginHandler } from "@/server/modules/admin/admin.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => adminLoginHandler(req));
