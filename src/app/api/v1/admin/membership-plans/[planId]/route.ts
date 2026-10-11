import { withErrorHandling } from "@/server/middleware/error-handler";
import { updatePlanHandler } from "@/server/modules/admin/plans-admin.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updatePlanHandler(req, ctx.params as { planId: string }));
