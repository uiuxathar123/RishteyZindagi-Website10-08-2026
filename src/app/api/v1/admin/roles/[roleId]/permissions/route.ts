import { withErrorHandling } from "@/server/middleware/error-handler";
import { setRolePermissionsHandler } from "@/server/modules/staff/staff.controller";

export const dynamic = "force-dynamic";

export const PUT = withErrorHandling((req, ctx) => setRolePermissionsHandler(req, ctx.params as { roleId: string }));
