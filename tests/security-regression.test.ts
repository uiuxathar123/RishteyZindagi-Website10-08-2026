/**
 * B10: cross-cutting security regression suite — the master brief's
 * explicit §3 minimum list, for everything NOT already covered by a
 * dedicated B6-B9 test file (IDOR, block-bypass, OTP replay/brute-force,
 * payment replay, and most rate-limit call sites all already have their
 * own direct coverage — see BACKEND.md's B10 section for the full
 * cross-reference). This file adds what was genuinely missing:
 * cross-module auth/session/role-tampering/privilege-escalation checks,
 * a real rate-limit trip, malformed/oversized input, secret-leakage
 * grepping across real response bodies, and the two fixes this phase's
 * audit found (payment amount/currency tampering rejection, blocked-pair
 * direct profile-view bypass).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { GET as listAuditLogs } from "@/app/api/v1/admin/audit-logs/route";
import { GET as listAdminUsers } from "@/app/api/v1/admin/users/route";
import { GET as listGateways } from "@/app/api/v1/admin/payment-gateways/route";
import { PATCH as updateGateway } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/route";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { GET as getProfileById } from "@/app/api/v1/profiles/[profileId]/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { POST as blockUser } from "@/app/api/v1/interactions/blocks/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, deviceSessions, memberships, paymentGateways, users } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { hashSessionToken } from "@/server/lib/session";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests, __setDevPaymentMismatchForTests } from "@/server/modules/payments/providers/dev.provider";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetPaymentGatewaysForTests,
  activateMembershipForTests,
} from "./helpers/reset-db";
import { req, createVerifiedMember, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token?: string) {
  return req(url, body, { token, method: "POST" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `sec-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Security Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

describe("B10 security regressions", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  // --- Authentication bypass -------------------------------------------

  describe("authentication bypass", () => {
    it("[authn-no-token] a protected endpoint with no Authorization header is rejected with 401, not a crash", async () => {
      const res = await getMe(greq("http://localhost/api/v1/users/me"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
    });

    it("[authn-garbage-token] a syntactically-plausible but nonexistent bearer token is rejected with 401", async () => {
      const res = await getMe(greq("http://localhost/api/v1/users/me", "not-a-real-session-token-at-all"));
      expect(res.status).toBe(401);
    });

    it("[authn-session-replay] a logged-out (revoked) session token is rejected on the very next call", async () => {
      const member = await createVerifiedMember("sec-replay");
      const before = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      expect(before.status).toBe(200);

      await logoutRoute(greq("http://localhost/api/v1/auth/logout", member.sessionToken));

      const after = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      expect(after.status).toBe(401);
    });

    it("[authn-session-expired] an expired session token is rejected even though it was never revoked", async () => {
      const member = await createVerifiedMember("sec-expired");
      await db
        .update(deviceSessions)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(deviceSessions.tokenHash, hashSessionToken(member.sessionToken)));

      const res = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      expect(res.status).toBe(401);
    });

    it("[authn-suspended-account] an existing, valid session for a now-SUSPENDED account is rejected", async () => {
      const member = await createVerifiedMember("sec-suspended");
      const before = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      expect(before.status).toBe(200);

      await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, member.userId));

      const res = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.message.toLowerCase()).toContain("not active");
    });

    it("[authn-suspended-cannot-login] a SUSPENDED account cannot obtain a fresh session via password login either", async () => {
      const member = await createVerifiedMember("sec-suspended-login");
      await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, member.userId));

      const res = await loginRoute(preq("http://localhost/api/v1/auth/login", { email: member.email, password: "correcthorsebattery" }));
      expect(res.status).toBe(401);
    });
  });

  // --- Authorization bypass / privilege escalation ----------------------

  describe("authorization bypass and privilege escalation", () => {
    it("[authz-member-cannot-reach-admin-endpoint] a valid MEMBER session gets 403 (or 401), never a peek, at an admin-only endpoint", async () => {
      const member = await createVerifiedMember("sec-authz-member");
      const res = await listAdminUsers(greq("http://localhost/api/v1/admin/users", member.sessionToken));
      expect([401, 403]).toContain(res.status);
    });

    it("[priv-esc-audit-view] a STAFF_ADMIN (lacking the SUPER_ADMIN-only audit.view permission) cannot list audit logs", async () => {
      const staffToken = await seedAdmin("STAFF_ADMIN");
      const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs", staffToken));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("AUTHORIZATION_ERROR");
    });

    it("[priv-esc-audit-view-allowed] a SUPER_ADMIN can list audit logs (control case — proves the 403 above is permission-based, not broken)", async () => {
      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs", superToken));
      expect(res.status).toBe(200);
    });

    it("[role-tamper-request-body] a client-supplied role/permission/ownership field in a request body is silently ignored, never honored", async () => {
      const attacker = await createVerifiedMember("sec-role-tamper");
      const res = await createProfile(
        preq(
          "http://localhost/api/v1/profiles/me",
          {
            gender: "MALE",
            dateOfBirth: "1995-01-01",
            // None of these are real fields on CreateProfileInput —
            // proving the server never reads unvalidated body fields for
            // anything security-relevant, regardless of whether the
            // specific schema uses .strict() (zod's default "strip"
            // behavior already discards them before the service layer
            // ever sees them).
            role: "SUPER_ADMIN",
            isAdmin: true,
            userId: "00000000-0000-0000-0000-000000000099",
            profileStatus: "READY_FOR_VISIBILITY",
            permissions: ["staff.manage"],
          },
          attacker.sessionToken
        )
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      // Server-derived ownership (from the session, never the body) and
      // server-computed status (never client-suppliable) both hold.
      expect(data.profile.userId).toBe(attacker.userId);
      expect(data.profile.profileStatus).not.toBe("READY_FOR_VISIBILITY");

      // And the attacker's own session is still a completely ordinary
      // member session — no admin capability was granted.
      const adminCheck = await listAdminUsers(greq("http://localhost/api/v1/admin/users", attacker.sessionToken));
      expect([401, 403]).toContain(adminCheck.status);
    });
  });

  // --- Rate limiting -----------------------------------------------------

  describe("rate-limit enforcement", () => {
    it("[rate-limit-trips] exceeding an endpoint's configured limit returns a clean 429, not a crash or silent pass-through", async () => {
      // /auth/login is rate-limited to 10/60s per IP (see auth.controller.ts)
      // — deliberately using wrong credentials so we're only exercising the
      // rate limiter, not real auth state, and every request shares the
      // same (absent) x-forwarded-for so they share one bucket key.
      const attempt = () => loginRoute(preq("http://localhost/api/v1/auth/login", { email: "nobody@example.com", password: "wrongpassword" }));
      const results = [];
      for (let i = 0; i < 11; i++) {
        results.push(await attempt());
      }
      const statuses = results.map((r) => r.status);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
      const body = await results[10].json();
      expect(body.error.code).toBe("RATE_LIMITED");
    });
  });

  // --- Input validation ----------------------------------------------------

  describe("malformed and oversized input rejection", () => {
    it("[malformed-uuid-param] a non-uuid route parameter is rejected with 400, not a raw DB error", async () => {
      const member = await createVerifiedMember("sec-bad-uuid");
      const res = await respondInterest(
        preq(`http://localhost/api/v1/interactions/interests/not-a-uuid`, { status: "ACCEPTED" }, member.sessionToken),
        { params: { interestId: "not-a-uuid" } }
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("[malformed-enum] an out-of-enum value is rejected with 400", async () => {
      const member = await createVerifiedMember("sec-bad-enum");
      const fakeId = "11111111-1111-1111-1111-111111111111";
      const res = await respondInterest(preq(`http://localhost/api/v1/interactions/interests/${fakeId}`, { status: "HACKED" }, member.sessionToken), {
        params: { interestId: fakeId },
      });
      expect(res.status).toBe(400);
    });

    it("[malformed-pagination] a negative page/pageSize is rejected, not silently clamped or crashed on", async () => {
      const member = await createVerifiedMember("sec-bad-page");
      const res = await searchProfiles(greq("http://localhost/api/v1/search/profiles?page=-1&pageSize=-5", member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[oversized-input] an aboutMe field far past its documented max length is rejected, not truncated silently", async () => {
      const member = await createVerifiedMember("sec-oversized");
      const res = await createProfile(
        preq("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1994-01-01", aboutMe: "x".repeat(5000) }, member.sessionToken)
      );
      expect(res.status).toBe(400);
    });

    it("[unexpected-body-fields-stripped] extra unexpected fields on a .strict() endpoint are rejected outright (defense in depth)", async () => {
      const member = await createVerifiedMember("sec-strict-body");
      const target = await createVerifiedMember("sec-strict-target");
      const res = await blockUser(
        preq("http://localhost/api/v1/interactions/blocks", { targetUserId: target.userId, reason: "spam", extraField: "should not be allowed" }, member.sessionToken)
      );
      expect(res.status).toBe(400);
    });
  });

  // --- Secret / data-exposure leakage --------------------------------------

  describe("secret-leakage prevention", () => {
    it("[no-secret-leak-user] GET /users/me never contains passwordHash or any *Hash field", async () => {
      const member = await createVerifiedMember("sec-leak-user");
      const res = await getMe(greq("http://localhost/api/v1/users/me", member.sessionToken));
      const raw = JSON.stringify(await res.json());
      expect(raw.toLowerCase()).not.toContain("passwordhash");
      expect(raw.toLowerCase()).not.toContain("tokenhash");
    });

    it("[no-secret-leak-admin-list] admin user listing never leaks passwordHash", async () => {
      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await listAdminUsers(greq("http://localhost/api/v1/admin/users", superToken));
      const raw = JSON.stringify(await res.json());
      expect(raw.toLowerCase()).not.toContain("passwordhash");
    });

    it("[no-secret-leak-gateway-config] payment gateway config responses never leak encrypted credential blobs or plaintext secrets", async () => {
      await resetPaymentGatewaysForTests();
      const superToken = await seedAdmin("SUPER_ADMIN");
      const [gateway] = await db.select().from(paymentGateways).limit(1);
      await updateGateway(
        req(
          `http://localhost/api/v1/admin/payment-gateways/${gateway.id}`,
          { apiKey: "SECRET_API_KEY_VALUE", apiSecret: "SECRET_API_SECRET_VALUE" },
          { token: superToken, method: "PATCH" }
        ),
        { params: { gatewayId: gateway.id } }
      );
      const res = await listGateways(greq("http://localhost/api/v1/admin/payment-gateways", superToken));
      const raw = JSON.stringify(await res.json());
      expect(raw).not.toContain("SECRET_API_KEY_VALUE");
      expect(raw).not.toContain("SECRET_API_SECRET_VALUE");
      expect(raw.toLowerCase()).not.toContain("encrypted");
      expect(raw.toLowerCase()).not.toContain("apisecret");
    });
  });

  // --- Payment amount/currency tampering (B10 fix) --------------------------

  describe("payment amount/currency tampering", () => {
    it("[pay-amount-mismatch-rejected] a gateway confirming a different amount than checkout requested is rejected, not activated", async () => {
      await resetPaymentGatewaysForTests();
      __clearDevPaymentStoreForTests();
      const member = await createVerifiedMember("sec-pay-mismatch");
      const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
      const { data: checkoutData } = await checkoutRes.json();

      // Simulate a gateway that confirms SUCCESS but for a different
      // (much lower) amount than it was actually asked to charge — e.g.
      // a tampered checkout widget or a gateway-side bug.
      __setDevPaymentMismatchForTests(checkoutData.providerOrderId, { amountInSmallestUnit: 1 });

      const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, member.sessionToken), {
        params: { paymentId: checkoutData.paymentId },
      });
      const { data } = await verifyRes.json();
      expect(data.status).toBe("FAILED");
      expect(data.payment.status).toBe("FAILED");

      const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, checkoutData.membershipId));
      expect(membershipRow.status).not.toBe("ACTIVE");
    });

    it("[pay-currency-mismatch-rejected] a gateway confirming a different currency than checkout requested is rejected, not activated", async () => {
      await resetPaymentGatewaysForTests();
      __clearDevPaymentStoreForTests();
      const member = await createVerifiedMember("sec-pay-currency-mismatch");
      const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
      const { data: checkoutData } = await checkoutRes.json();

      __setDevPaymentMismatchForTests(checkoutData.providerOrderId, { currency: "USD" });

      const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, member.sessionToken), {
        params: { paymentId: checkoutData.paymentId },
      });
      const { data } = await verifyRes.json();
      expect(data.status).toBe("FAILED");
    });

    it("[pay-amount-match-still-activates] control case: an UNtampered dev-provider verify (amount/currency matching) still activates normally", async () => {
      await resetPaymentGatewaysForTests();
      __clearDevPaymentStoreForTests();
      const member = await createVerifiedMember("sec-pay-match");
      const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
      const { data: checkoutData } = await checkoutRes.json();

      const verifyRes = await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, member.sessionToken), {
        params: { paymentId: checkoutData.paymentId },
      });
      const { data } = await verifyRes.json();
      expect(data.status).toBe("SUCCESS");
    });
  });

  // --- Blocked-pair direct profile-view bypass (B10 fix) --------------------

  describe("blocked-pair bypass attempts", () => {
    it("[block-profile-view-bypass] once blocked, the blocked party cannot view the blocker's profile directly by id either", async () => {
      const a = await buildReadyProfile("sec-block-view-a", refs, { gender: "FEMALE" });
      const b = await buildReadyProfile("sec-block-view-b", refs, { gender: "MALE" });

      // B can see A's profile before any block exists.
      const before = await getProfileById(greq(`http://localhost/api/v1/profiles/${a.profileId}`, b.member.sessionToken), {
        params: { profileId: a.profileId },
      });
      expect(before.status).toBe(200);

      await blockUser(preq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

      const afterAsBlocked = await getProfileById(greq(`http://localhost/api/v1/profiles/${a.profileId}`, b.member.sessionToken), {
        params: { profileId: a.profileId },
      });
      expect(afterAsBlocked.status).toBe(404);

      // Symmetric: the blocker (A) also can't view B's profile either.
      const afterAsBlocker = await getProfileById(greq(`http://localhost/api/v1/profiles/${b.profileId}`, a.member.sessionToken), {
        params: { profileId: b.profileId },
      });
      expect(afterAsBlocker.status).toBe(404);
    });
  });

  // --- Error-leakage prevention (extends error-handling.test.ts's coverage) -

  describe("error-leakage prevention on real routes", () => {
    it("[error-leak-not-found] a genuinely nonexistent resource 404s with a generic message — no SQL, path, or stack fragment", async () => {
      const member = await createVerifiedMember("sec-error-leak");
      const fakeId = "22222222-2222-2222-2222-222222222222";
      const res = await getProfileById(greq(`http://localhost/api/v1/profiles/${fakeId}`, member.sessionToken), { params: { profileId: fakeId } });
      const raw = JSON.stringify(await res.json());
      expect(raw).not.toMatch(/select |insert into|drizzle|\/home\/|\.ts:\d+/i);
    });
  });
});
