import { withErrorHandling } from "@/server/middleware/error-handler";
import { decideApprovalHandler } from "@/server/modules/profiles/approval.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => decideApprovalHandler(req, ctx.params as { profileId: string }));
