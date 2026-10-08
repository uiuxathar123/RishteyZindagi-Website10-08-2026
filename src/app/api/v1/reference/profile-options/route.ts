import { withErrorHandling } from "@/server/middleware/error-handler";
import { getProfileReferenceOptionsHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

// Public, unauthenticated reference/lookup data for populating profile
// onboarding and edit forms — see getProfileReferenceOptionsHandler.
export const GET = withErrorHandling((req) => getProfileReferenceOptionsHandler(req));
