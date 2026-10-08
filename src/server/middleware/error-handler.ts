/**
 * Wraps every `src/app/api/v1/**` route handler. This is the single place
 * that: assigns a request ID, times the request, converts any thrown
 * `AppError` into the standard error envelope with the right status code,
 * converts any *unexpected* error into a generic 500 without leaking its
 * message/stack to the client, and writes one structured log line per
 * request. A handler should never construct its own error Response —
 * throwing an `AppError` subclass (see lib/errors.ts) is always enough.
 */
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, InternalError } from "@/server/lib/errors";
import { fail } from "@/server/lib/response";
import { logError, logRequest } from "@/server/lib/logger";
import type { AuthContext } from "./authenticate";
import { enforceRateLimitPolicy, PolicyRateLimitError } from "./rate-limit-policy";

export interface RouteContext {
  requestId: string;
  auth?: AuthContext;
  // B3: dynamic route segments (e.g. /profiles/[profileId]) — Next.js
  // passes these as a second argument to the exported route function
  // (`(req, { params }) => ...`); B1 never had a dynamic route, so
  // nothing previously threaded it through. Optional and additive: every
  // existing single-argument `withErrorHandling((req) => ...)` call site
  // is unaffected, since it never reads ctx.params.
  params?: Record<string, string>;
}

type Handler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;
type NextRouteArgs = { params?: Record<string, string> };

export function withErrorHandling(handler: Handler) {
  return async (req: NextRequest, nextRouteArgs?: NextRouteArgs): Promise<NextResponse> => {
    const requestId = randomUUID();
    const start = Date.now();
    const ctx: RouteContext = { requestId, params: nextRouteArgs?.params };

    try {
      // PCP: central, shared-store rate-limit policy (additive hook — a no-op
      // when the policy is disabled or no rule matches).
      await enforceRateLimitPolicy(req);
      const res = await handler(req, ctx);
      logRequest({
        requestId,
        method: req.method,
        endpoint: new URL(req.url).pathname,
        statusCode: res.status,
        durationMs: Date.now() - start,
        userId: ctx.auth?.subject.id,
      });
      return res;
    } catch (err) {
      const appError = err instanceof AppError ? err : new InternalError();
      if (!(err instanceof AppError)) {
        // Never leak the original message/stack to the client — but do
        // log it, since that's the only place we'll ever see it again.
        logError("unhandled-route-error", err, { requestId });
      }

      logRequest({
        requestId,
        method: req.method,
        endpoint: new URL(req.url).pathname,
        statusCode: appError.statusCode,
        durationMs: Date.now() - start,
        userId: ctx.auth?.subject.id,
        error: { name: appError.name, message: appError.message, code: appError.code },
      });

      const failure = fail(appError.code, appError.message, appError.statusCode, appError.details);
      if (appError instanceof PolicyRateLimitError) {
        failure.headers.set("Retry-After", String(appError.retryAfterSeconds));
      }
      return failure;
    }
  };
}
