import { withErrorHandling } from "@/server/middleware/error-handler";
import { getUserDetailHandler } from "@/server/modules/admin/users-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) =>
  getUserDetailHandler(req, ctx.params as { userId: string })
);
