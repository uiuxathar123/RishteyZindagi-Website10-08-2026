/**
 * The "dev OTP mode can never run in production" guarantee, tested in
 * isolation from the database (these modules — providers/factory.ts and
 * providers/dev.provider.ts — only ever read env config, never touch
 * Postgres) so NODE_ENV can be safely stubbed to "production" per test
 * without disturbing the shared test-database connection every other
 * suite in this run relies on.
 *
 * Two independent layers are checked, matching factory.ts's own
 * "defense in depth, not redundancy" comment:
 *  1. The factory refuses to hand out DevOtpProvider at all when
 *     NODE_ENV=production, even if devMode=true is passed in (as it would
 *     be if the otp_configs.dev_mode column were ever left on by mistake).
 *  2. DevOtpProvider.send() itself refuses to run under NODE_ENV=production
 *     even if something bypassed the factory and constructed one directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("OTP dev-mode production guard (isolated — no DB)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder");
    vi.stubEnv("AUTH_SECRET", process.env.AUTH_SECRET ?? "test-secret");
  });

  it("getOtpProvider never returns DevOtpProvider when NODE_ENV=production, even with devMode=true", async () => {
    const { getOtpProvider } = await import("@/server/modules/otp/providers/factory");
    const provider = getOtpProvider("EMAIL", true);
    expect(provider.constructor.name).not.toBe("DevOtpProvider");
    expect(provider.method).toBe("EMAIL");
  });

  it("DevOtpProvider.send refuses to run under NODE_ENV=production even if constructed directly", async () => {
    const { DevOtpProvider } = await import("@/server/modules/otp/providers/dev.provider");
    const provider = new DevOtpProvider("EMAIL");
    await expect(
      provider.send({ to: "x@example.com", code: "123456", purpose: "LOGIN", expirySeconds: 300 })
    ).rejects.toThrow(/production/);
  });

  it("DevOtpProvider.isConfigured() is false under NODE_ENV=production", async () => {
    const { DevOtpProvider } = await import("@/server/modules/otp/providers/dev.provider");
    const provider = new DevOtpProvider("EMAIL");
    expect(provider.isConfigured()).toBe(false);
  });
});
