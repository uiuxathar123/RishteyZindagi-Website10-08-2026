import { withErrorHandling } from "@/server/middleware/error-handler";
import { requestLoginOtpHandler } from "@/server/modules/auth/auth.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => requestLoginOtpHandler(req));
