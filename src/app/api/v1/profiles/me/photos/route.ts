import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMyPhotosHandler, uploadMyPhotoHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMyPhotosHandler(req));
export const POST = withErrorHandling((req) => uploadMyPhotoHandler(req));
