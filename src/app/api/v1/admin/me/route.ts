import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminMeHandler } from "@/server/modules/admin/admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminMeHandler(req));
