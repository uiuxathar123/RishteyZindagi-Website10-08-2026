import { describe, it, expect, vi, afterEach } from "vitest";
import { logError, logRequest } from "@/server/lib/logger";

afterEach(() => vi.restoreAllMocks());

describe("log redaction", () => {
  it("[log-redacts-provider-secrets] credential-like keys are replaced, however deeply nested, and ordinary fields are kept", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("t", new Error("boom"), {
      provider: "RAZORPAY",
      nested: { razorpay_signature: "SIG-VALUE", keySecret: "KS-VALUE", webhookSecret: "WS-VALUE", SMTP_PASS: "PW-VALUE", clientSecret: "CS-VALUE", passphrase: "PP-VALUE" },
    });
    const line = String(err.mock.calls[0][0]);
    for (const v of ["SIG-VALUE", "KS-VALUE", "WS-VALUE", "PW-VALUE", "CS-VALUE", "PP-VALUE"]) expect(line).not.toContain(v);
    expect(line).toContain('"provider":"RAZORPAY"');
    expect(line).toContain("[REDACTED]");
  });

  it("[log-request-fixed-fields] a request log line never contains the original secret-bearing fields", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logRequest({ requestId: "r", method: "POST", endpoint: "/x", statusCode: 200, durationMs: 1, password: "PW-VALUE", token: "TOK-VALUE" } as never);
    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain("PW-VALUE");
    expect(line).not.toContain("TOK-VALUE");
  });
});
