import { withErrorHandling } from "@/server/middleware/error-handler";
import { verifyProfileHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

// B3 §17: admin verification foundation — gated by the existing
// "profiles.verify" permission (seeded in B1), not a new authorization
// concept. A normal member session is rejected inside the service layer.
export const PATCH = withErrorHandling((req, ctx) =>
  verifyProfileHandler(req, ctx.params as { profileId: string })
);
