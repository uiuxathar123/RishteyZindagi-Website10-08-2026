import { withErrorHandling } from "@/server/middleware/error-handler";
import { publicSupportContactHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(() => publicSupportContactHandler());
