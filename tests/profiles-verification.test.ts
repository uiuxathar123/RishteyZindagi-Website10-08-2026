/**
 * B3 §17/§21: admin profile-verification foundation — gated by B1's
 * existing "profiles.verify" permission (no new authorization concept),
 * and a normal member can never reach or influence it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { PATCH as verifyProfile } from "@/app/api/v1/admin/profiles/[profileId]/verify/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember } from "./helpers/profile-fixtures";

function jsonReq(url: string, body: unknown, token?: string) {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN", email: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Verifier Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
  const loginRes = await loginAdmin(
    new NextRequest("http://localhost/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "adminpassword1" }),
    })
  );
  const { data } = await loginRes.json();
  return data.sessionToken as string;
}

const ctx = (profileId: string) => ({ params: { profileId } });

describe("Admin profile verification", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("a STAFF_ADMIN (has profiles.verify by default) can verify a profile, and it's audit-logged", async () => {
    const member = await createVerifiedMember();
    const createRes = await createProfile(
      req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken })
    );
    const { data: createData } = await createRes.json();
    const adminToken = await seedAdmin("STAFF_ADMIN", "verifier1@rishteyzindagi.local");

    const res = await verifyProfile(
      jsonReq(`http://localhost/api/v1/admin/profiles/${createData.profile.id}/verify`, { status: "VERIFIED", notes: "Docs checked." }, adminToken),
      ctx(createData.profile.id)
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.profile.verificationStatus).toBe("VERIFIED");
    expect(data.profile.verifiedAt).toBeTruthy();

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "profile.verification_changed"));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("rejects a plain member session with 403 — a user can never verify their own or anyone's profile", async () => {
    const member = await createVerifiedMember();
    const createRes = await createProfile(
      req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken })
    );
    const { data: createData } = await createRes.json();

    const res = await verifyProfile(
      jsonReq(`http://localhost/api/v1/admin/profiles/${createData.profile.id}/verify`, { status: "VERIFIED" }, member.sessionToken),
      ctx(createData.profile.id)
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHORIZATION_ERROR");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const member = await createVerifiedMember();
    const createRes = await createProfile(
      req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken })
    );
    const { data: createData } = await createRes.json();

    const res = await verifyProfile(
      jsonReq(`http://localhost/api/v1/admin/profiles/${createData.profile.id}/verify`, { status: "VERIFIED" }),
      ctx(createData.profile.id)
    );
    expect(res.status).toBe(401);
  });

  it("can reject a profile's verification with a reason, and revert to UNVERIFIED", async () => {
    const member = await createVerifiedMember();
    const createRes = await createProfile(
      req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken })
    );
    const { data: createData } = await createRes.json();
    const adminToken = await seedAdmin("SUPER_ADMIN", "verifier2@rishteyzindagi.local");

    const rejectRes = await verifyProfile(
      jsonReq(`http://localhost/api/v1/admin/profiles/${createData.profile.id}/verify`, { status: "REJECTED", notes: "Photo unclear." }, adminToken),
      ctx(createData.profile.id)
    );
    const { data: rejectData } = await rejectRes.json();
    expect(rejectData.profile.verificationStatus).toBe("REJECTED");
    expect(rejectData.profile.verifiedAt).toBeNull();

    const revertRes = await verifyProfile(
      jsonReq(`http://localhost/api/v1/admin/profiles/${createData.profile.id}/verify`, { status: "UNVERIFIED" }, adminToken),
      ctx(createData.profile.id)
    );
    const { data: revertData } = await revertRes.json();
    expect(revertData.profile.verificationStatus).toBe("UNVERIFIED");
  });
});
