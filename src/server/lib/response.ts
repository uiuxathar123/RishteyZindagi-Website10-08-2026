/**
 * The one place that builds a NextResponse for the API. Every route
 * handler returns `ok(...)` or lets `withErrorHandling` build the error
 * envelope via `fail(...)` — no handler constructs `NextResponse.json`
 * directly, so the response shape can never drift from this contract:
 *
 * SUCCESS: { "success": true,  "data": {...}, "message": "..." }
 * ERROR:   { "success": false, "error": { "code": "...", "message": "..." } }
 */
import { NextResponse } from "next/server";
import type { ErrorCode } from "./errors";

export function ok<T>(data: T, message = "OK", status = 200) {
  return NextResponse.json({ success: true, data, message }, { status });
}

export function created<T>(data: T, message = "Created") {
  return ok(data, message, 201);
}

export function fail(code: ErrorCode, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
}
