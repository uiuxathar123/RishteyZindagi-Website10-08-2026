/**
 * B16 (integration phase): proves the small ADDITIVE backend changes the
 * frontend integration needed, without touching any frozen B1-B15 test:
 *   - GET /admin/me            (admin identity + effective permission keys)
 *   - userId on the AUTHENTICATED public profile view (never on anonymous)
 *   - counterpart.profileId on interaction lists
 *   - communities seeded for every religion that has them
 *   - the dev-only payment order store is process-wide (globalThis anchor)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as adminMe } from "@/app/api/v1/admin/me/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { GET as getPublicProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { POST as sendInterest, GET as listInterests } from "@/app/api/v1/interactions/interests/route";
import { POST as shortlistUser, GET as listShortlist } from "@/app/api/v1/interactions/shortlist/route";
import { GET as getReferenceOptions } from "@/app/api/v1/reference/profile-options/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { DevPaymentProvider } from "@/server/modules/payments/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetMatchingWeightsForTests,
  activateMembershipForTests,
} from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function get(url: string, token?: string) {
  return new NextRequest(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
}

async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN", email: string, password: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: `Test ${roleName}`, email, passwordHash: await hashPassword(password), roleId: role.id });
  const res = await loginAdmin(req("http://localhost/api/v1/admin/login", { email, password }));
  expect(res.status).toBe(200);
  return (await res.json()).data.sessionToken as string;
}

describe("B16 additive integration changes", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  describe("GET /admin/me", () => {
    it("[b16-admin-me-401] rejects a request without a session", async () => {
      const res = await adminMe(get("http://localhost/api/v1/admin/me"));
      expect(res.status).toBe(401);
    });

    it("[b16-admin-me-super] SUPER_ADMIN gets its identity and every permission key, sorted", async () => {
      const token = await seedAdmin("SUPER_ADMIN", "b16-super@rishteyzindagi.local", "superpassword1");
      const res = await adminMe(get("http://localhost/api/v1/admin/me", token));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.admin.role).toBe("SUPER_ADMIN");
      expect(data.admin.email).toBe("b16-super@rishteyzindagi.local");
      expect(data.permissions).toEqual([...data.permissions].sort());
      expect(data.permissions).toEqual(expect.arrayContaining(["audit.view", "platform.settings.manage", "staff.manage", "users.view"]));
      expect(JSON.stringify(data)).not.toMatch(/passwordHash|password_hash/);
    });

    it("[b16-admin-me-staff] STAFF_ADMIN gets only its default grants (no audit.view / platform.settings.manage)", async () => {
      const token = await seedAdmin("STAFF_ADMIN", "b16-staff@rishteyzindagi.local", "staffpassword1");
      const res = await adminMe(get("http://localhost/api/v1/admin/me", token));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.admin.role).toBe("STAFF_ADMIN");
      expect(data.permissions).toEqual(["admin.ping", "profiles.verify", "reports.resolve", "users.view"]);
    });

    it("[b16-admin-me-member] a MEMBER session token is refused (separate identities)", async () => {
      const a = await buildReadyProfile("b16-me-member", refs);
      const res = await adminMe(get("http://localhost/api/v1/admin/me", a.member.sessionToken));
      expect([401, 403]).toContain(res.status);
    });
  });

  describe("identity link between profiles and users", () => {
    it("[b16-userid-authenticated] an authenticated viewer's profile view includes the owner's userId", async () => {
      const a = await buildReadyProfile("b16-view-a", refs, { gender: "FEMALE" });
      const b = await buildReadyProfile("b16-view-b", refs, { gender: "MALE" });
      const res = await getPublicProfile(get(`http://localhost/api/v1/profiles/${b.profileId}`, a.member.sessionToken), { params: { profileId: b.profileId } });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      const view = data.profile ?? data;
      expect(data.audience ?? view.audience).toBe("authenticated");
      expect(view.userId).toBe(b.member.userId);
    });

    it("[b16-userid-anonymous] an anonymous viewer never receives userId", async () => {
      const b = await buildReadyProfile("b16-anon-b", refs, { gender: "MALE" });
      const res = await getPublicProfile(get(`http://localhost/api/v1/profiles/${b.profileId}`), { params: { profileId: b.profileId } });
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain(b.member.userId);
    });

    it("[b16-counterpart-profileid] interest and shortlist rows carry the counterpart's profileId", async () => {
      const a = await buildReadyProfile("b16-cp-a", refs, { gender: "FEMALE" });
      const b = await buildReadyProfile("b16-cp-b", refs, { gender: "MALE" });
      await activateMembershipForTests(a.member.userId);

      const sent = await sendInterest(req("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, { token: a.member.sessionToken }));
      expect(sent.status).toBe(201);
      const listed = await listInterests(get("http://localhost/api/v1/interactions/interests?direction=sent", a.member.sessionToken));
      const { data } = await listed.json();
      expect(data.interests[0].counterpart).toEqual({ userId: b.member.userId, name: expect.anything(), profileId: b.profileId });

      const sl = await shortlistUser(req("http://localhost/api/v1/interactions/shortlist", { targetUserId: b.member.userId }, { token: a.member.sessionToken }));
      expect([200, 201]).toContain(sl.status);
      const slList = await listShortlist(get("http://localhost/api/v1/interactions/shortlist", a.member.sessionToken));
      const slData = (await slList.json()).data;
      expect(slData.shortlist[0].counterpart.profileId).toBe(b.profileId);
    });

    it("[b16-counterpart-no-profile] a profile-less counterpart is either refused or reported with profileId null (never invented)", async () => {
      const a = await buildReadyProfile("b16-np-a", refs, { gender: "FEMALE" });
      // a member with NO profile row
      const { createVerifiedMember } = await import("./helpers/profile-fixtures");
      const bare = await createVerifiedMember("b16-np-bare");
      await activateMembershipForTests(a.member.userId);
      const sent = await sendInterest(req("http://localhost/api/v1/interactions/interests", { toUserId: bare.userId }, { token: a.member.sessionToken }));
      if (sent.status === 201) {
        const listed = await listInterests(get("http://localhost/api/v1/interactions/interests?direction=sent", a.member.sessionToken));
        const { data } = await listed.json();
        expect(data.interests[0].counterpart.profileId).toBeNull();
      } else {
        // The backend may refuse an interest to a profile-less member; either way no profileId is invented.
        expect([400, 403, 404]).toContain(sent.status);
      }
    });
  });

  describe("reference data", () => {
    it("[b16-communities-seeded] every religion with seeded communities returns them from /reference/profile-options", async () => {
      const res = await getReferenceOptions(new NextRequest(`http://localhost/api/v1/reference/profile-options?religionId=${refs.religionId}`));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(Array.isArray(data.communities)).toBe(true);
      expect(data.communities.length).toBeGreaterThan(0);
    });
  });

  describe("dev payment provider store", () => {
    it("[b16-dev-payment-store-global] an order created by one provider instance verifies through another", async () => {
      const first = new DevPaymentProvider();
      const second = new DevPaymentProvider();
      const order = await first.createOrder({ amountInSmallestUnit: 19900, currency: "INR", receiptRef: "b16-test", simulateOutcome: "SUCCESS" } as never);
      const verified = await second.verifyPayment({ providerOrderId: order.providerOrderId } as never);
      expect(verified.status).toBe("SUCCESS");
      // The store itself is anchored on globalThis so separately-bundled
      // route handlers (next dev) share one Map.
      const store = (globalThis as unknown as { __rzDevOrderStore?: Map<string, unknown> }).__rzDevOrderStore;
      expect(store).toBeInstanceOf(Map);
      expect(store!.has(order.providerOrderId)).toBe(true);
    });
  });
});
