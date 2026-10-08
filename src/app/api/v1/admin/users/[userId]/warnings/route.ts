import { withErrorHandling } from "@/server/middleware/error-handler";
import { issueWarningHandler, listWarningsForUserHandler } from "@/server/modules/warnings/warnings.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) =>
  issueWarningHandler(req, ctx.params as { userId: string })
);
export const GET = withErrorHandling((req, ctx) =>
  listWarningsForUserHandler(req, ctx.params as { userId: string })
);
