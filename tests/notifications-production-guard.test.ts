/**
 * B7: the "dev notification mode can never run in production" guarantee —
 * structurally identical to tests/otp-production-guard.test.ts (same
 * isolated-from-the-database rationale: providers/factory.ts and
 * providers/dev.provider.ts only ever read env config, so NODE_ENV can be
 * safely stubbed to "production" per test without disturbing the shared
 * test-database connection every other suite in this run relies on).
 *
 * Two independent layers, matching factory.ts's own "defense in depth"
 * comment:
 *  1. The factory refuses to hand out DevNotificationProvider at all when
 *     NODE_ENV=production, even if devMode=true is passed in.
 *  2. DevNotificationProvider.send() itself refuses to run under
 *     NODE_ENV=production even if something bypassed the factory and
 *     constructed one directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Notification dev-mode production guard (isolated — no DB)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder");
    vi.stubEnv("AUTH_SECRET", process.env.AUTH_SECRET ?? "test-secret");
  });

  it("getNotificationProvider never returns DevNotificationProvider when NODE_ENV=production, even with devMode=true", async () => {
    const { getNotificationProvider } = await import("@/server/modules/notifications/providers/factory");
    const provider = getNotificationProvider("EMAIL", true);
    expect(provider.constructor.name).not.toBe("DevNotificationProvider");
    expect(provider.channel).toBe("EMAIL");
  });

  it("DevNotificationProvider.send refuses to run under NODE_ENV=production even if constructed directly", async () => {
    const { DevNotificationProvider } = await import("@/server/modules/notifications/providers/dev.provider");
    const provider = new DevNotificationProvider("EMAIL");
    await expect(provider.send({ to: "x@example.com", title: "t", body: "b" })).rejects.toThrow(/production/);
  });

  it("DevNotificationProvider.isConfigured() is false under NODE_ENV=production", async () => {
    const { DevNotificationProvider } = await import("@/server/modules/notifications/providers/dev.provider");
    const provider = new DevNotificationProvider("EMAIL");
    expect(provider.isConfigured()).toBe(false);
  });
});
