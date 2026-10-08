import { withErrorHandling } from "@/server/middleware/error-handler";
import { getOtpConfigHandler, updateOtpConfigHandler } from "@/server/modules/otp/otp-config.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getOtpConfigHandler(req));
export const PATCH = withErrorHandling((req) => updateOtpConfigHandler(req));
