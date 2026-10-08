import { withErrorHandling } from "@/server/middleware/error-handler";
import { listPlansHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listPlansHandler(req));
