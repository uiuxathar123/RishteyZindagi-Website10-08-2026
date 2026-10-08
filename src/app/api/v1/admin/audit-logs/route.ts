import { withErrorHandling } from "@/server/middleware/error-handler";
import { listAuditLogsHandler } from "@/server/modules/admin/audit-logs.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listAuditLogsHandler(req));
