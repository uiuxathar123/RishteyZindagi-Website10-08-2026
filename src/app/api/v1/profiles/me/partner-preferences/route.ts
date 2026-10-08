import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMyPreferencesHandler, upsertMyPreferencesHandler } from "@/server/modules/preferences/preferences.controller";

export const dynamic = "force-dynamic";

// B4: nested under profiles/me, matching the existing profiles/me/photos
// etc. convention rather than a top-level /preferences/partner route —
// see BACKEND.md's B4 section for why.
export const GET = withErrorHandling((req) => getMyPreferencesHandler(req));
export const PATCH = withErrorHandling((req) => upsertMyPreferencesHandler(req));
