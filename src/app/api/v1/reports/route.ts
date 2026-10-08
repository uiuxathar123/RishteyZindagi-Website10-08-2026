import { withErrorHandling } from "@/server/middleware/error-handler";
import { fileReportHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => fileReportHandler(req));
