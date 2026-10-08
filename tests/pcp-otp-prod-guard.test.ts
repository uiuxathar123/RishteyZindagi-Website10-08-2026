/** PCP: production-only OTP provider rules. getEnv() caches, so each case imports a fresh module graph with NODE_ENV=production. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs } from "@/server/db/schema";
import { resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createAdmin } from "./helpers/pcp";

describe("OTP provider — production rules", () => {
  beforeEach(async () => {
    await resetAdminUsers();
    await resetOtpConfigForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("[otp-prod-refuses-unconfigured] production: activating an unconfigured provider → 409 and nothing changes; legacy WHATSAPP → rejected", async () => {
    const admin = await createAdmin("SUPER_ADMIN");
    const ctx = { subject: { id: admin.id, type: "admin" as const }, adminRoleName: "SUPER_ADMIN", sessionId: "t" };
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("FAST2SMS_API_KEY", "");
    vi.stubEnv("FAST2SMS_OTP_ID", "");
    const svc = await import("@/server/modules/otp/otp-provider.service");
    await expect(svc.setActiveOtpProvider(ctx as never, "FAST2SMS_SMS", {})).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.setActiveOtpProvider(ctx as never, "EMAIL", {})).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.select().from(otpConfigs).where(eq(otpConfigs.id, 1)))[0].activeMethod).toBe("EMAIL");
    const legacy = await import("@/server/modules/otp/otp-config.service");
    await expect(legacy.updateConfig(ctx as never, { activeMethod: "WHATSAPP" }, {})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("[otp-prod-allows-configured] production: a configured provider can be activated", async () => {
    const admin = await createAdmin("SUPER_ADMIN");
    const ctx = { subject: { id: admin.id, type: "admin" as const }, adminRoleName: "SUPER_ADMIN", sessionId: "t" };
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAST2SMS_API_KEY", "key-abcdefghijk");
    vi.stubEnv("FAST2SMS_OTP_ID", "tmpl-1");
    const svc = await import("@/server/modules/otp/otp-provider.service");
    const view = await svc.setActiveOtpProvider(ctx as never, "FAST2SMS_SMS", {});
    expect(view.activeProvider).toBe("FAST2SMS_SMS");
    expect(view.providers.find((p) => p.key === "EMAIL")!.missing).toEqual(expect.arrayContaining(["SMTP_HOST"]));
  });
});
