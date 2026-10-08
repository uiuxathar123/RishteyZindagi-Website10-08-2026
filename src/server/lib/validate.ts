/**
 * Parses a JSON request body against a Zod schema, throwing a
 * `ValidationError` (caught centrally by the error-handler middleware)
 * instead of letting a malformed request reach a controller/service as
 * untyped `any`. Every route handler that accepts a body should go
 * through this rather than calling `req.json()` directly.
 */
import type { ZodSchema } from "zod";
import { ValidationError } from "./errors";

export async function parseJsonBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new ValidationError("One or more fields are invalid.", details);
  }
  return result.data;
}
