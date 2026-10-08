import { withErrorHandling } from "@/server/middleware/error-handler";
import {
  createMyProfileHandler,
  getMyProfileHandler,
  updateMyProfileHandler,
} from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getMyProfileHandler(req));
export const POST = withErrorHandling((req) => createMyProfileHandler(req));
// B3: partial update of the caller's own profile — see profiles.controller.ts.
export const PATCH = withErrorHandling((req) => updateMyProfileHandler(req));
