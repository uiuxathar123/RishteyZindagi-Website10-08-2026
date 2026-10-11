/**
 * B18 — Security Events feed (`audit.view`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GET as eventsRoute } from "@/app/api/v1/admin/security-events/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { PATCH as policyRoute } from "@/app/api/v1/admin/otp/policy/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { maskIdentifier } from "@/server/modules/admin/security-events.service";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1";
const events = (token: string | undefined, q = "") => eventsRoute(jreq(`${URL_}/admin/security-events${q}`, { token }));
const body = async (r: Response) => (await r.json()).data;

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("security events", () => {
  it("[sec-authz] anonymous 401; member 401/403; staff without audit.view 403; delegation revocable immediately", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const m = await createVerifiedMember("sec-authz");
    expect((await events(undefined)).status).toBe(401);
    expect([401, 403]).toContain((await events(m.sessionToken)).status);
    await revokePermission("STAFF_ADMIN", "audit.view");
    expect((await events(staff.token)).status).toBe(403);
    expect((await events(sup.token)).status).toBe(200);
    await grantPermission("STAFF_ADMIN", "audit.view");
    expect((await events(staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "audit.view");
    expect((await events(staff.token)).status).toBe(403);
  });

  it("[sec-feed] failed + successful member logins, admin logins and security changes appear; identifiers are masked; filters work", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const m = await createVerifiedMember("sec-feed");
    // a failed and a successful member login from a known device
    expect((await loginRoute(req(`${URL_}/auth/login`, { email: m.email, password: "wrong-password-1" }, { deviceId: m.deviceId }))).status).toBe(401);
    expect((await loginRoute(req(`${URL_}/auth/login`, { email: m.email, password: "correcthorsebattery" }, { deviceId: m.deviceId }))).status).toBe(200);
    // a security-relevant change
    expect((await policyRoute(jreq(`${URL_}/admin/otp/policy`, { method: "PATCH", token: sup.token, body: { workflow: "NEW_DEVICE_LOGIN", requirement: "OTP_NOT_REQUIRED", reason: "testing the feed" } }))).status).toBe(200);

    const all = await body(await events(sup.token));
    const kinds = all.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("LOGIN_FAILED");
    expect(kinds).toContain("LOGIN_SUCCEEDED");
    expect(kinds).toContain("otp.policy_changed");
    // newest first
    const times = all.items.map((i: { occurredAt: string }) => Date.parse(i.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // never the full address, never a secret-looking field
    const json = JSON.stringify(all);
    expect(json).not.toContain(m.email);
    expect(json).not.toMatch(/passwordHash|sessionToken|secret|hash/i); // "PASSWORD" is just the login method
    const failed = all.items.find((i: { kind: string }) => i.kind === "LOGIN_FAILED");
    expect(failed.subject).toBe(maskIdentifier(m.email));
    expect(failed.detail).toContain("INVALID_CREDENTIALS");

    expect((await body(await events(sup.token, "?type=LOGIN_FAILED"))).items.every((i: { kind: string }) => i.kind === "LOGIN_FAILED")).toBe(true);
    expect((await body(await events(sup.token, "?type=CHANGES"))).items.every((i: { source: string }) => i.source === "AUDIT")).toBe(true);
    expect((await body(await events(sup.token, "?actor=USER&type=LOGIN_SUCCEEDED"))).total).toBeGreaterThanOrEqual(1);
    expect((await body(await events(sup.token, "?type=LOGIN_SUCCEEDED&actor=ADMIN"))).items.every((i: { actorType: string }) => i.actorType === "ADMIN")).toBe(true);
  });

  it("[sec-validation] bad filters are 400; % and _ are literal; paging works", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    for (const q of ["?type=NOPE", "?actor=ROBOT", "?pageSize=51", "?page=0", "?dateFrom=garbage", "?dateFrom=2026-02-01&dateTo=2026-01-01"]) {
      expect((await events(sup.token, q)).status, q).toBe(400);
    }
    expect((await body(await events(sup.token, "?q=%25"))).total).toBe(0);
    const a = await body(await events(sup.token, "?pageSize=1&page=1"));
    expect(a.items.length).toBeLessThanOrEqual(1);
    expect(a.pageSize).toBe(1);
  });

  it("[sec-mask] identifier masking", () => {
    expect(maskIdentifier("someone@example.com")).toBe("s***@example.com");
    expect(maskIdentifier("9876543210")).toBe("98******10");
    expect(maskIdentifier("abc")).toBe("***");
    expect(maskIdentifier(null)).toBeNull();
  });
});
