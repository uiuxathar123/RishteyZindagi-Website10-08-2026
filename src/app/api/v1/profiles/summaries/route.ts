import { withErrorHandling } from "@/server/middleware/error-handler";
import { getProfileSummariesHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

// Batched card data for list screens: GET /profiles/summaries?ids=<uuid>,<uuid>,… (max 50).
// Members only. Same visibility rules as GET /profiles/:id, but one request and no profile-view events.
export const GET = withErrorHandling((req) => getProfileSummariesHandler(req));
