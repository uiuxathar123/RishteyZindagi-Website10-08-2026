import { withErrorHandling } from "@/server/middleware/error-handler";
import { deleteMyPhotoHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling((req, ctx) =>
  deleteMyPhotoHandler(req, ctx.params as { photoId: string })
);
