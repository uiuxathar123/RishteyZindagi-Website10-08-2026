import { withErrorHandling } from "@/server/middleware/error-handler";
import { listPlansForMyRegionHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listPlansForMyRegionHandler(req));
