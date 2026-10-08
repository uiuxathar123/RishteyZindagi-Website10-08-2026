import { withErrorHandling } from "@/server/middleware/error-handler";
import { listAllReportCategoriesHandler, createReportCategoryHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listAllReportCategoriesHandler(req));
export const POST = withErrorHandling((req) => createReportCategoryHandler(req));
