import { withErrorHandling } from "@/server/middleware/error-handler";
import { cancelAutoRenewHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => cancelAutoRenewHandler(req, ctx.params as { membershipId: string }));
