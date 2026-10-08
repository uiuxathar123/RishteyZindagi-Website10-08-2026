import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMembershipsHandler } from "@/server/modules/admin/memberships-admin.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMembershipsHandler(req));
