import { withErrorHandling } from "@/server/middleware/error-handler";
import { createRoleHandler, listRolesHandler } from "@/server/modules/staff/staff.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listRolesHandler(req));
export const POST = withErrorHandling((req) => createRoleHandler(req));
