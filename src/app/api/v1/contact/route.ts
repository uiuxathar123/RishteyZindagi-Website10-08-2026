import { withErrorHandling } from "@/server/middleware/error-handler";
import { submitContactHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => submitContactHandler(req));
