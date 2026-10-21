import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminGetCompanyVerificationHandler, adminDecideCompanyVerificationHandler } from "@/server/modules/matchmaking/introductions.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => adminGetCompanyVerificationHandler(req, ctx.params as Record<string, string>));
export const POST = withErrorHandling((req, ctx) => adminDecideCompanyVerificationHandler(req, ctx.params as Record<string, string>));
