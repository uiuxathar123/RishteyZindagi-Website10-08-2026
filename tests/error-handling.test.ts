import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { withErrorHandling } from "@/server/middleware/error-handler";
import { ValidationError, NotFoundError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { POST as register } from "@/app/api/v1/auth/register/route";

describe("centralized error handling", () => {
  it("converts a thrown AppError into the standard error envelope + matching status", async () => {
    const handler = withErrorHandling(async () => {
      throw new NotFoundError("Widget not found.");
    });
    const res = await handler(new NextRequest("http://localhost/api/v1/whatever"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "Widget not found." },
    });
  });

  it("converts an UNEXPECTED (non-AppError) throw into a generic 500 — never leaks the real message", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("leaked-db-connection-string-or-stack-trace");
    });
    const res = await handler(new NextRequest("http://localhost/api/v1/whatever"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("leaked-db-connection-string-or-stack-trace");
  });

  it("propagates a ValidationError's field-level details to the client", async () => {
    const handler = withErrorHandling(async () => {
      throw new ValidationError("Bad input.", [{ path: "email", message: "required" }]);
    });
    const res = await handler(new NextRequest("http://localhost/api/v1/whatever"));
    const body = await res.json();
    expect(body.error.details).toEqual([{ path: "email", message: "required" }]);
  });

  it("a successful handler still returns the standard success envelope", async () => {
    const handler = withErrorHandling(async () => ok({ hello: "world" }));
    const res = await handler(new NextRequest("http://localhost/api/v1/whatever"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { hello: "world" }, message: "OK" });
  });

  it("rejects malformed JSON in a real route with a clean 400, not a raw parser crash", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    const res = await register(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
