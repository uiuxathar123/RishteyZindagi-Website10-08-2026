import { withErrorHandling } from "@/server/middleware/error-handler";
import { reorderMyPhotosHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req) => reorderMyPhotosHandler(req));
