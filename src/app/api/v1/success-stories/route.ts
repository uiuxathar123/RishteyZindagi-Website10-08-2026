import { withErrorHandling } from "@/server/middleware/error-handler";
import { publicStoriesHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(() => publicStoriesHandler());
