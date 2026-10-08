import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMatchingWeightsHandler, updateMatchingWeightsHandler } from "@/server/modules/recommendations/weights.controller";

export const dynamic = "force-dynamic";

// B5 gap-fix: admin-configurable matching category weights. Gated by the
// existing platform.settings.manage permission (see weights.service.ts) —
// no new authorization concept, matching the admin/otp/config precedent.
export const GET = withErrorHandling((req) => getMatchingWeightsHandler(req));
export const PATCH = withErrorHandling((req) => updateMatchingWeightsHandler(req));
