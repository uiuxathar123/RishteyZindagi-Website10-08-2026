import { withErrorHandling } from "@/server/middleware/error-handler";
import { createPlanHandler, listPlansHandler } from "@/server/modules/admin/plans-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listPlansHandler(req));
export const POST = withErrorHandling((req) => createPlanHandler(req));
