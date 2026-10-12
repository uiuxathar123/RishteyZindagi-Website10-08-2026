import { withErrorHandling } from "@/server/middleware/error-handler";
import { listApprovalsHandler } from "@/server/modules/profiles/approval.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listApprovalsHandler(req));
