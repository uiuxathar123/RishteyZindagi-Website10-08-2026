import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateCommunityHandler } from "@/server/modules/admin/communities-admin.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updateCommunityHandler(req, ctx.params as { communityId: string }));
