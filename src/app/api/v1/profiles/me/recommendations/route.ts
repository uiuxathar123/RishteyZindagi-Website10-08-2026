import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyRecommendationsHandler } from "@/server/modules/recommendations/recommendations.controller";

export const dynamic = "force-dynamic";

// B5: deterministic, mutual, explainable compatibility recommendations —
// nested under profiles/me, matching the existing profiles/me/partner-
// preferences and profiles/me/photos convention rather than a top-level
// /recommendations route. Authenticated-only (no anonymous variant —
// see recommendations.controller.ts).
export const GET = withErrorHandling((req) => getMyRecommendationsHandler(req));
