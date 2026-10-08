/**
 * B14 §38: GET /api/v1/health/ready — the new deep-readiness check,
 * additive alongside the untouched GET /api/v1/health liveness check
 * (see tests/health.test.ts, still passing unmodified).
 *
 * Asserts: the response shape (application/database/dependency layers
 * reported separately), that the database layer is genuinely live
 * against the real test database, and — the security-relevant part —
 * that no credential, API key, or connection string ever appears
 * anywhere in the response, only the boolean-ish "configured"/
 * "not_configured" strings B14's spec requires.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReady } from "@/app/api/v1/health/ready/route";

describe("GET /api/v1/health/ready", () => {
  it("reports application/database/dependency layers with the documented shape", async () => {
    const req = new NextRequest("http://localhost/api/v1/health/ready");
    const res = await getReady(req);
    const body = await res.json();

    // Database is really up in this test run (same real Postgres every
    // other test file uses) — a genuine, non-mocked check.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.checks.application).toBe("alive");
    expect(body.data.checks.database).toBe("connected");

    // .env.test (tests/setup.ts) configures no OTP channel and no
    // STORAGE_PROVIDER override — so this is a deterministic "degraded"
    // reading of real, unmocked env state, not a fabricated one.
    expect(body.data.status).toBe("degraded");
    expect(body.data.checks.dependencies.otp).toEqual({
      email: "not_configured",
      sms: "not_configured",
      whatsapp: "not_configured",
    });
    // STORAGE_PROVIDER is unset in .env.test -> defaults to "local",
    // which is always isConfigured()=true (see factory.ts).
    expect(body.data.checks.dependencies.storageProvider).toBe("configured");
  });

  it("never leaks a raw credential, API key, or connection string in the response", async () => {
    const req = new NextRequest("http://localhost/api/v1/health/ready");
    const res = await getReady(req);
    const raw = JSON.stringify(await res.json());

    // The test env's own real secrets (see .env.test) must never appear,
    // however they might be serialized.
    expect(raw).not.toContain(process.env.AUTH_SECRET ?? "test-only-secret");
    expect(raw).not.toContain(process.env.DATABASE_URL ?? "");
    expect(raw).not.toContain("postgresql://");
    if (process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY) {
      expect(raw).not.toContain(process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY);
    }
    // Only the documented boolean-ish vocabulary should ever appear for
    // dependency status — never an object with a "key"/"secret"/"token"
    // field shape.
    expect(raw).not.toMatch(/"(apiKey|api_key|secret|token|password)"/i);
  });

  it("GET /api/v1/health (the original liveness check) is unchanged", async () => {
    const { GET: getHealth } = await import("@/app/api/v1/health/route");
    const req = new NextRequest("http://localhost/api/v1/health");
    const res = await getHealth(req);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: { status: "ok", database: "connected" },
      message: "OK",
    });
  });
});
