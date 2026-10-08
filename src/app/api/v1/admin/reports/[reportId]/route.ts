import { withErrorHandling } from "@/server/middleware/error-handler";
import { dismissReportHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) =>
  dismissReportHandler(req, ctx.params as { reportId: string })
);
