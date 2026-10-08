import { withErrorHandling } from "@/server/middleware/error-handler";
import { revokePushTokenHandler } from "@/server/modules/devices/push-tokens.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) =>
  revokePushTokenHandler(req, ctx.params as { tokenOrId: string })
);
