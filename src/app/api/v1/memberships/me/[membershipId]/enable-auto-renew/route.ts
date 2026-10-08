import { withErrorHandling } from "@/server/middleware/error-handler";
import { enableAutoRenewHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => enableAutoRenewHandler(req, ctx.params as { membershipId: string }));
