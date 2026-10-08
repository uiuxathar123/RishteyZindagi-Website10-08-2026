import { withErrorHandling } from "@/server/middleware/error-handler";
import { getDashboardHandler } from "@/server/modules/admin/dashboard.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getDashboardHandler(req));
