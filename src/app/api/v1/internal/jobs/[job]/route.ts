import { withErrorHandling } from "@/server/middleware/error-handler";
import { runJobHandler } from "@/server/jobs/jobs.controller";

export const dynamic = "force-dynamic";
// Many HTTP cron services (and Vercel-style cron) invoke with GET; others POST.
export const GET = withErrorHandling((req, ctx) => runJobHandler(req, ctx.params?.job ?? ""));
export const POST = withErrorHandling((req, ctx) => runJobHandler(req, ctx.params?.job ?? ""));
