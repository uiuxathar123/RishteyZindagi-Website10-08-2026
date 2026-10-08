/**
 * PCP: in production the legacy gateway-admin endpoint may only activate
 * Razorpay / PhonePe. getEnv() caches, so this runs with a fresh module graph
 * and NODE_ENV=production stubbed (same technique as payments-production-guard.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { paymentGateways } from "@/server/db/schema";
import { resetAdminUsers, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createAdmin } from "./helpers/pcp";

describe("legacy gateway activation — production guard", () => {
  beforeEach(async () => {
    await resetAdminUsers();
    await resetPaymentGatewaysForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("[legacy-activate-prod-guard] production: Cashfree/PayU/Paytm → 409, Razorpay/PhonePe allowed; non-production unchanged", async () => {
    const admin = await createAdmin("SUPER_ADMIN");
    const rows = await db.select().from(paymentGateways);
    const legacy = rows.find((r) => !["Razorpay", "PhonePe Payment Gateway"].includes(r.name))!;
    const phonepe = rows.find((r) => r.name === "PhonePe Payment Gateway")!;
    const ctx = { subject: { id: admin.id, type: "admin" as const }, adminRoleName: "SUPER_ADMIN", sessionId: "test" };

    // Outside production the frozen B8 behaviour is preserved.
    const dev = await import("@/server/modules/payments/gateways.service");
    await expect(dev.activateGateway(ctx as never, legacy.id)).resolves.toBeTruthy();

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const prod = await import("@/server/modules/payments/gateways.service");
    await expect(prod.activateGateway(ctx as never, legacy.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prod.activateGateway(ctx as never, phonepe.id)).resolves.toBeTruthy();
    const active = await db.select().from(paymentGateways).where(eq(paymentGateways.isActive, true));
    expect(active.map((a) => a.name)).toEqual(["PhonePe Payment Gateway"]);
  });
});
