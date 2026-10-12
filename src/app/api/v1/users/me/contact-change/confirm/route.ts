import { withErrorHandling } from "@/server/middleware/error-handler";
import { confirmContactChangeHandler } from "@/server/modules/account/member-settings.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => confirmContactChangeHandler(req));
