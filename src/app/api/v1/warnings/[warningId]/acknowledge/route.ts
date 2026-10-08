import { withErrorHandling } from "@/server/middleware/error-handler";
import { acknowledgeWarningHandler } from "@/server/modules/warnings/warnings.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) =>
  acknowledgeWarningHandler(req, ctx.params as { warningId: string })
);
