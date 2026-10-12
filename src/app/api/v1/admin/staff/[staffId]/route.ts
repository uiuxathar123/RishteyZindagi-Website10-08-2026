import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateStaffHandler } from "@/server/modules/staff/staff.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updateStaffHandler(req, ctx.params as { staffId: string }));
