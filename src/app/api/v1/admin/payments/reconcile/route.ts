import { withErrorHandling } from "@/server/middleware/error-handler";
import { listReconcileRunsHandler, runReconcileHandler } from "@/server/modules/admin/reconcile-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listReconcileRunsHandler(req));
export const POST = withErrorHandling((req) => runReconcileHandler(req));
