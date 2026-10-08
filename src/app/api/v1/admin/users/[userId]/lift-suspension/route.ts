import { withErrorHandling } from "@/server/middleware/error-handler";
import { liftSuspensionHandler } from "@/server/modules/reports/reports.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) =>
  liftSuspensionHandler(req, ctx.params as { userId: string })
);
