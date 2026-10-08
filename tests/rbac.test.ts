import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as registerUser } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as loginUser } from "@/app/api/v1/auth/login/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { GET as ping } from "@/app/api/v1/admin/ping/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { requirePermission } from "@/server/middleware/rbac";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";

const MEMBER_DEVICE = "rbac-test-device-1";

function jsonRequest(url: string, body: unknown, token?: string, deviceId?: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, token?: string) {
  return new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
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

describe("RBAC / authorization foundation", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
  });

  it("rejects an unauthorized request (no session token) with 401", async () => {
    const res = await ping(getRequest("http://localhost/api/v1/admin/ping"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("rejects a plain member session with 403 — RBAC governs admin routes only", async () => {
    const registerRes = await registerUser(
      jsonRequest("http://localhost/api/v1/auth/register", {
        name: "Member One",
        email: "member1@example.com",
        mobileNumber: "9000000001",
      })
    );
    const { data: registerData } = await registerRes.json();
    const code = getDevOtpCode(registerData.identifier, "SIGNUP")!;

    const verifyRes = await verifySignupOtp(
      jsonRequest("http://localhost/api/v1/auth/verify-signup-otp", { identifier: registerData.identifier, code })
    );
    const { data: verifyData } = await verifyRes.json();

    await setPassword(
      jsonRequest(
        "http://localhost/api/v1/auth/set-password",
        { identifier: registerData.identifier, ticket: verifyData.ticket, password: "memberpassword1" },
        undefined,
        MEMBER_DEVICE
      )
    );

    const loginRes = await loginUser(
      jsonRequest(
        "http://localhost/api/v1/auth/login",
        { email: "member1@example.com", password: "memberpassword1" },
        undefined,
        MEMBER_DEVICE
      )
    );
    const { data } = await loginRes.json();

    const res = await ping(getRequest("http://localhost/api/v1/admin/ping", data.sessionToken));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHORIZATION_ERROR");
  });

  it("allows a STAFF_ADMIN session through the RBAC-gated route", async () => {
    await seedStaffAdmin("staff1@rishteyzindagi.local", "staffpassword1");
    const loginRes = await loginAdmin(
      jsonRequest("http://localhost/api/v1/admin/login", {
        email: "staff1@rishteyzindagi.local",
        password: "staffpassword1",
      })
    );
    expect(loginRes.status).toBe(200);
    const { data } = await loginRes.json();
    expect(data.admin.role).toBe("STAFF_ADMIN");

    const res = await ping(getRequest("http://localhost/api/v1/admin/ping", data.sessionToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ pong: true, role: "STAFF_ADMIN", adminId: data.admin.id });
  });

  it("permission foundation: STAFF_ADMIN has its default grants but not staff.manage", async () => {
    const staff = await seedStaffAdmin("staff2@rishteyzindagi.local", "staffpassword2");
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, staff.roleId));
    const ctx = { subject: { id: staff.id, type: "admin" as const }, adminRoleName: role.name, sessionId: "n/a" };

    await expect(requirePermission(ctx, "users.view")).resolves.toBeUndefined();
    await expect(requirePermission(ctx, "staff.manage")).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("permission foundation: SUPER_ADMIN has every permission, including staff.manage", async () => {
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN"));
    const [admin] = await db
      .insert(adminUsers)
      .values({ name: "Test Super", email: "super1@rishteyzindagi.local", passwordHash: await hashPassword("x"), roleId: role.id })
      .returning();
    const ctx = { subject: { id: admin.id, type: "admin" as const }, adminRoleName: "SUPER_ADMIN", sessionId: "n/a" };

    await expect(requirePermission(ctx, "staff.manage")).resolves.toBeUndefined();
    await expect(requirePermission(ctx, "platform.settings.manage")).resolves.toBeUndefined();
  });
});
