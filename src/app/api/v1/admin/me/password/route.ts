import { withErrorHandling } from "@/server/middleware/error-handler";
import { changePasswordHandler } from "@/server/modules/staff/staff.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => changePasswordHandler(req));
