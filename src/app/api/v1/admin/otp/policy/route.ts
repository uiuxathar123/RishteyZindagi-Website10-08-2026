import { withErrorHandling } from "@/server/middleware/error-handler";
import { getOtpPolicyHandler, patchOtpPolicyHandler } from "@/server/modules/platform-settings/platform-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getOtpPolicyHandler(req));
export const PATCH = withErrorHandling((req) => patchOtpPolicyHandler(req));
