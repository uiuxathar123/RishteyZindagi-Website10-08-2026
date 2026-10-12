import { withErrorHandling } from "@/server/middleware/error-handler";
import { searchAccessHandler } from "@/server/modules/search/search.controller";

export const dynamic = "force-dynamic";

// B18: tells the search screen which filters the caller may use, so it can
// lock the rest. Soft-auth like /search/profiles; the server still enforces
// the rule on every search request.
export const GET = withErrorHandling((req) => searchAccessHandler(req));
