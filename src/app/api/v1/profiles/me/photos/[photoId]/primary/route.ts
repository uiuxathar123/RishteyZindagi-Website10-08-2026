import { withErrorHandling } from "@/server/middleware/error-handler";
import { setMyPrimaryPhotoHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) =>
  setMyPrimaryPhotoHandler(req, ctx.params as { photoId: string })
);
