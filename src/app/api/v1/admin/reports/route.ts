import { withErrorHandling } from "@/server/middleware/error-handler";
import { listReportsHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listReportsHandler(req));
