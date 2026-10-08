import { withErrorHandling } from "@/server/middleware/error-handler";
import { listUsersHandler } from "@/server/modules/admin/users-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listUsersHandler(req));
