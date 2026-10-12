import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPrivacyHandler, updatePrivacyHandler } from "@/server/modules/account/member-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getPrivacyHandler(req));
export const PATCH = withErrorHandling((req) => updatePrivacyHandler(req));
