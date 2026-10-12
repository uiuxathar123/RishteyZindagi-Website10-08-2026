import { withErrorHandling } from "@/server/middleware/error-handler";
import { resetPasswordHandler } from "@/server/modules/staff/staff.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => resetPasswordHandler(req, ctx.params as { staffId: string }));
