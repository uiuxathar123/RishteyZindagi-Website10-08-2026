import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPublicProfileHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

// Public/gated profile view — works for anonymous, authenticated, and
// owner/admin callers alike (see getPublicProfileHandler's soft auth).
export const GET = withErrorHandling((req, ctx) =>
  getPublicProfileHandler(req, ctx.params as { profileId: string })
);
