/**
 * Direct tests of the OTP business-rule core (otp.service.ts) — purpose
 * isolation, single-use, attempt-limiting, resend cooldown/window, ticket
 * expiry/reuse, and the "never fabricate delivery" honesty guarantee for
 * an unconfigured real provider. Exercised directly against the service
 * (not through HTTP) since these are unit-level invariants of the OTP
 * core itself, independent of any particular auth flow built on top of it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as otpService from "@/server/modules/otp/otp.service";
import { db } from "@/server/db/client";
import { otpConfigs } from "@/server/db/schema";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";

const meta = { ipAddress: "127.0.0.1", userAgent: "vitest" };

describe("otp.service core", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
  });

  it("full ticket-bridged flow: request -> verify -> issue ticket -> consume ticket", async () => {
    const result = await otpService.requestOtp({ identifier: "core-1@example.com", purpose: "SIGNUP", metadata: { x: 1 }, meta });
    expect(result.channel).toBe("EMAIL");

    const code = getDevOtpCode("core-1@example.com", "SIGNUP")!;
    const verified = await otpService.verifyOtpAndIssueTicket("core-1@example.com", "SIGNUP", code);
    expect(verified.metadata).toEqual({ x: 1 });

    const consumed = await otpService.consumeTicket("core-1@example.com", "SIGNUP", verified.ticket);
    expect(consumed.metadata).toEqual({ x: 1 });
  });

  it("a code is single-use — verifying it twice fails the second time", async () => {
    await otpService.requestOtp({ identifier: "core-2@example.com", purpose: "LOGIN", meta });
    const code = getDevOtpCode("core-2@example.com", "LOGIN")!;

    await otpService.verifyOtpDirect("core-2@example.com", "LOGIN", code);
    await expect(otpService.verifyOtpDirect("core-2@example.com", "LOGIN", code)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("a ticket is single-use — consuming it twice fails the second time", async () => {
    await otpService.requestOtp({ identifier: "core-3@example.com", purpose: "SIGNUP", meta });
    const code = getDevOtpCode("core-3@example.com", "SIGNUP")!;
    const verified = await otpService.verifyOtpAndIssueTicket("core-3@example.com", "SIGNUP", code);

    await otpService.consumeTicket("core-3@example.com", "SIGNUP", verified.ticket);
    await expect(otpService.consumeTicket("core-3@example.com", "SIGNUP", verified.ticket)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("purposes are fully isolated — a code issued for one purpose never verifies another", async () => {
    await otpService.requestOtp({ identifier: "core-4@example.com", purpose: "LOGIN", meta });
    const loginCode = getDevOtpCode("core-4@example.com", "LOGIN")!;

    await expect(otpService.verifyOtpDirect("core-4@example.com", "FORGOT_PASSWORD", loginCode)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
    // ...but the same code still works for the purpose it was actually issued for.
    await expect(otpService.verifyOtpDirect("core-4@example.com", "LOGIN", loginCode)).resolves.toBeDefined();
  });

  it("wrong codes are rejected without consuming the real one", async () => {
    await otpService.requestOtp({ identifier: "core-5@example.com", purpose: "LOGIN", meta });
    const code = getDevOtpCode("core-5@example.com", "LOGIN")!;

    await expect(otpService.verifyOtpDirect("core-5@example.com", "LOGIN", "000000")).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
    // The real code still works — one wrong guess doesn't invalidate it.
    await expect(otpService.verifyOtpDirect("core-5@example.com", "LOGIN", code)).resolves.toBeDefined();
  });

  it("locks out after maxVerifyAttempts wrong guesses — even the correct code then fails", async () => {
    await db.update(otpConfigs).set({ maxVerifyAttempts: 3 }).where(eq(otpConfigs.id, 1));
    await otpService.requestOtp({ identifier: "core-6@example.com", purpose: "LOGIN", meta });
    const code = getDevOtpCode("core-6@example.com", "LOGIN")!;

    for (let i = 0; i < 3; i++) {
      await expect(otpService.verifyOtpDirect("core-6@example.com", "LOGIN", "000000")).rejects.toMatchObject({
        code: "AUTHENTICATION_ERROR",
      });
    }
    await expect(otpService.verifyOtpDirect("core-6@example.com", "LOGIN", code)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("enforces the resend cooldown between requests for the same identifier+purpose", async () => {
    await db.update(otpConfigs).set({ resendCooldownSeconds: 3600 }).where(eq(otpConfigs.id, 1));
    await otpService.requestOtp({ identifier: "core-7@example.com", purpose: "LOGIN", meta });
    await expect(otpService.requestOtp({ identifier: "core-7@example.com", purpose: "LOGIN", meta })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("enforces the max-resends-per-window limit even after the cooldown elapses", async () => {
    await db.update(otpConfigs).set({ resendCooldownSeconds: 0, maxResendAttempts: 2 }).where(eq(otpConfigs.id, 1));
    await otpService.requestOtp({ identifier: "core-8@example.com", purpose: "LOGIN", meta });
    await otpService.requestOtp({ identifier: "core-8@example.com", purpose: "LOGIN", meta });
    await expect(otpService.requestOtp({ identifier: "core-8@example.com", purpose: "LOGIN", meta })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("issuing a new code invalidates the previous live one", async () => {
    await db.update(otpConfigs).set({ resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1));
    await otpService.requestOtp({ identifier: "core-9@example.com", purpose: "LOGIN", meta });
    const firstCode = getDevOtpCode("core-9@example.com", "LOGIN")!;

    await otpService.requestOtp({ identifier: "core-9@example.com", purpose: "LOGIN", meta });
    await expect(otpService.verifyOtpDirect("core-9@example.com", "LOGIN", firstCode)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("a ticket cannot be redeemed for a different purpose than it was issued for", async () => {
    await otpService.requestOtp({ identifier: "core-10@example.com", purpose: "SIGNUP", meta });
    const code = getDevOtpCode("core-10@example.com", "SIGNUP")!;
    const verified = await otpService.verifyOtpAndIssueTicket("core-10@example.com", "SIGNUP", code);

    await expect(otpService.consumeTicket("core-10@example.com", "FORGOT_PASSWORD", verified.ticket)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("refuses to send when OTP delivery is disabled platform-wide", async () => {
    await db.update(otpConfigs).set({ enabled: false }).where(eq(otpConfigs.id, 1));
    await expect(otpService.requestOtp({ identifier: "core-11@example.com", purpose: "LOGIN", meta })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("honestly fails rather than fabricating delivery when devMode is off and no real provider is configured", async () => {
    // .env.test sets no EMAIL_PROVIDER/EMAIL_API_KEY, so with devMode off
    // the real EmailOtpProvider is used and must throw — this is the
    // "never fabricate a successful send" guarantee under test.
    await db.update(otpConfigs).set({ devMode: false, activeMethod: "EMAIL" }).where(eq(otpConfigs.id, 1));
    await expect(otpService.requestOtp({ identifier: "core-12@example.com", purpose: "LOGIN", meta })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    // And critically: no OTP row was created for an attempt that was never
    // actually delivered.
    expect(getDevOtpCode("core-12@example.com", "LOGIN")).toBeUndefined();
  });

  it("resendOtp reuses the prior metadata/userId without the caller resupplying it", async () => {
    await db.update(otpConfigs).set({ resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1));
    await otpService.requestOtp({ identifier: "core-13@example.com", purpose: "SIGNUP", metadata: { name: "Resend Test" }, meta });

    await otpService.resendOtp("core-13@example.com", "SIGNUP", meta);
    const code = getDevOtpCode("core-13@example.com", "SIGNUP")!;
    const verified = await otpService.verifyOtpAndIssueTicket("core-13@example.com", "SIGNUP", code);
    expect(verified.metadata).toEqual({ name: "Resend Test" });
  });

  it("resendOtp for an identifier+purpose that never had a first OTP succeeds without sending anything (no enumeration)", async () => {
    const result = await otpService.resendOtp("never-requested@example.com", "FORGOT_PASSWORD", meta);
    expect(result.channel).toBe("EMAIL");
    expect(getDevOtpCode("never-requested@example.com", "FORGOT_PASSWORD")).toBeUndefined();
  });
});
