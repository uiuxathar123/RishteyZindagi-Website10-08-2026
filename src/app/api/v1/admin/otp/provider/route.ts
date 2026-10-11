import { withErrorHandling } from "@/server/middleware/error-handler";
import { getOtpProviderHandler, patchOtpProviderHandler } from "@/server/modules/otp/otp-provider.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getOtpProviderHandler(req));
export const PATCH = withErrorHandling((req) => patchOtpProviderHandler(req));
