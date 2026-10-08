import { withErrorHandling } from "@/server/middleware/error-handler";
import { healthHandler } from "@/server/modules/health/health.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => healthHandler());
