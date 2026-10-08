import { withErrorHandling } from "@/server/middleware/error-handler";
import { searchProfilesHandler } from "@/server/modules/search/search.controller";

export const dynamic = "force-dynamic";

// B4: deterministic profile search — works for both anonymous and
// authenticated callers (see search.controller.ts's tryAuthenticate); no
// matching/recommendation intelligence, that's exclusively B5 scope.
export const GET = withErrorHandling((req) => searchProfilesHandler(req));
