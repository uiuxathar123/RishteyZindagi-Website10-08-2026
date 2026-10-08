/**
 * Admin OTP config route: RBAC gating (reuses the existing
 * platform.settings.manage permission — no new authorization code), the
 * DB-level singleton/exactly-one-active-method enforcement, and the
 * production dev-mode guard.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getConfig, PATCH as patchConfig } from "@/app/api/v1/admin/otp/config/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as registerUser } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as loginUser } from "@/app/api/v1/auth/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, otpConfigs } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";

function req(url: string, method: string, body?: unknown, token?: string, deviceId?: string) {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedStaffAdmin(email: string, password: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
  const [admin] = await db
    .insert(adminUsers)
    .values({ name: "Test Staff", email, passwordHash: await hashPassword(password), roleId: role.id })
    .returning();
  return admin;
}

async function loginAsSuperAdmin() {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN"));
  const email = "super-otp-config@rishteyzindagi.local";
  await db.insert(adminUsers).values({ name: "Super", email, passwordHash: await hashPassword("superpassword1"), roleId: role.id });
  const res = await loginAdmin(req("http://localhost/api/v1/admin/login", "POST", { email, password: "superpassword1" }));
  const { data } = await res.json();
  return data.sessionToken as string;
}

describe("Admin OTP config: GET/PATCH /api/v1/admin/otp/config", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await getConfig(req("http://localhost/api/v1/admin/otp/config", "GET"));
    expect(res.status).toBe(401);
  });

  it("rejects a plain member session with 403", async () => {
    const registerRes = await registerUser(
      req("http://localhost/api/v1/auth/register", "POST", { name: "Member", email: "member-otpcfg@example.com", mobileNumber: "9444455556" })
    );
    const { data: regData } = await registerRes.json();
    const code = getDevOtpCode(regData.identifier, "SIGNUP")!;
    const verifyRes = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", "POST", { identifier: regData.identifier, code }));
    const { data: verifyData } = await verifyRes.json();
    await setPassword(
      req("http://localhost/api/v1/auth/set-password", "POST", { identifier: regData.identifier, ticket: verifyData.ticket, password: "memberpassword1" }, undefined, "member-otpcfg-device")
    );
    const loginRes = await loginUser(
      req("http://localhost/api/v1/auth/login", "POST", { email: "member-otpcfg@example.com", password: "memberpassword1" }, undefined, "member-otpcfg-device")
    );
    const { data: loginData } = await loginRes.json();

    const res = await getConfig(req("http://localhost/api/v1/admin/otp/config", "GET", undefined, loginData.sessionToken));
    expect(res.status).toBe(403);
  });

  it("rejects a STAFF_ADMIN without platform.settings.manage with 403", async () => {
    await seedStaffAdmin("staff-otpcfg@rishteyzindagi.local", "staffpassword1");
    const loginRes = await loginAdmin(req("http://localhost/api/v1/admin/login", "POST", { email: "staff-otpcfg@rishteyzindagi.local", password: "staffpassword1" }));
    const { data } = await loginRes.json();

    const res = await getConfig(req("http://localhost/api/v1/admin/otp/config", "GET", undefined, data.sessionToken));
    expect(res.status).toBe(403);
  });

  it("allows SUPER_ADMIN to read the config, never exposing provider secrets", async () => {
    const token = await loginAsSuperAdmin();
    const res = await getConfig(req("http://localhost/api/v1/admin/otp/config", "GET", undefined, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activeMethod).toBe("EMAIL");
    expect(body.data).not.toHaveProperty("smsConfig");
    expect(body.data).not.toHaveProperty("emailConfig");
    expect(body.data.providers).toEqual({ sms: false, whatsapp: false, email: false });
  });

  it("allows SUPER_ADMIN to change the active method — only ever one method active at a time by construction", async () => {
    const token = await loginAsSuperAdmin();
    const res = await patchConfig(req("http://localhost/api/v1/admin/otp/config", "PATCH", { activeMethod: "SMS" }, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activeMethod).toBe("SMS");

    const [row] = await db.select().from(otpConfigs).where(eq(otpConfigs.id, 1));
    expect(row.activeMethod).toBe("SMS");
  });

  it("rejects an invalid activeMethod value with 400 VALIDATION_ERROR", async () => {
    const token = await loginAsSuperAdmin();
    const res = await patchConfig(req("http://localhost/api/v1/admin/otp/config", "PATCH", { activeMethod: "CARRIER_PIGEON" }, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("the otp_configs table can never hold a second row — CHECK (id = 1) enforces the singleton at the DB level", async () => {
    await expect(
      db.insert(otpConfigs).values({ id: 2, activeMethod: "EMAIL" })
    ).rejects.toThrow();
  });

  it("every change is audit-logged with a non-secret summary", async () => {
    const token = await loginAsSuperAdmin();
    await patchConfig(req("http://localhost/api/v1/admin/otp/config", "PATCH", { otpLength: 4 }, token));

    const { auditLogs } = await import("@/server/db/schema");
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "otp_config.update"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows[rows.length - 1].metadata)).not.toMatch(/config":\{/); // no raw provider-config blob
  });
});
