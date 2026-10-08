/**
 * Structured (JSON) request logging. One line per finished request, always
 * including timestamp/requestId/method/endpoint/statusCode/durationMs, and
 * userId/error info when available — never the fields in REDACTED_KEYS,
 * however deeply nested, so a stray `password`/`otp`/`token` field in a
 * request or metadata payload can never reach the log output.
 */

const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "otp",
  "otpcode",
  "token",
  "sessiontoken",
  "tokenhash",
  "authorization",
  "apikey",
  "secret",
  "cardnumber",
  "cvv",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redact(val, depth + 1);
  }
  return out;
}

export interface RequestLogFields {
  requestId: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  error?: { name: string; message: string; code?: string };
}

export function logRequest(fields: RequestLogFields) {
  const line = {
    timestamp: new Date().toISOString(),
    ...(redact(fields) as RequestLogFields),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function logError(context: string, err: unknown, extra?: Record<string, unknown>) {
  const line = {
    timestamp: new Date().toISOString(),
    level: "error",
    context,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message }
        : { name: "UnknownError", message: String(err) },
    ...(extra ? (redact(extra) as Record<string, unknown>) : {}),
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(line));
}
