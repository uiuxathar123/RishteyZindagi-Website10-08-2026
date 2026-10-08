import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateReportCategoryHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) =>
  updateReportCategoryHandler(req, ctx.params as { categoryId: string })
);
