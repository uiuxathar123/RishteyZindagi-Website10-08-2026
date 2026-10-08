import { withErrorHandling } from "@/server/middleware/error-handler";
import { pingHandler } from "@/server/modules/admin/admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => pingHandler(req));
