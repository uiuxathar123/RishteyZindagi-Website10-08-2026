/**
 * B11: push-notification device-token registration — the genuinely new
 * piece this phase adds (see push-tokens.repository/service/controller.ts
 * and schema.ts's `devicePushTokens` comment). Covers register/list/revoke,
 * upsert-by-token idempotency (no duplicate rows), ownership/IDOR
 * (a client can never register against another user's identity, or revoke
 * another user's token), and the addressing wiring into
 * notifications.service.ts's `notify()` for the PUSH channel.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as registerPushToken, GET as listPushTokens } from "@/app/api/v1/devices/push-tokens/route";
import { DELETE as revokePushToken } from "@/app/api/v1/devices/push-tokens/[tokenOrId]/route";
import { db } from "@/server/db/client";
import { devicePushTokens } from "@/server/db/schema";
import { notify } from "@/server/modules/notifications/notifications.service";
import { getDevNotificationSend, __clearDevNotificationStoreForTests } from "@/server/modules/notifications/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember } from "./helpers/profile-fixtures";

function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}
function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function dreq(url: string, token: string) {
  return req(url, undefined, { token, method: "DELETE" });
}

let tokenCounter = 0;
function freshToken(): string {
  tokenCounter += 1;
  return `fcm-test-token-${tokenCounter}-${Date.now()}`;
}

describe("B11 push-token registration", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
    __clearDevNotificationStoreForTests();
  });

  describe("Register / list / revoke", () => {
    it("[push-token-register] registering a device token creates a row scoped to the caller's own session identity", async () => {
      const member = await createVerifiedMember("push-register");
      const token = freshToken();
      const res = await registerPushToken(
        preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken)
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.device.token).toBe(token);
      expect(data.device.platform).toBe("ANDROID");
      expect(typeof data.device.id).toBe("string");

      const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(row.userId).toBe(member.userId);
      expect(row.revokedAt).toBeNull();
    });

    it("[push-token-requires-auth] registering without a bearer token is rejected", async () => {
      const res = await registerPushToken(req("http://localhost/api/v1/devices/push-tokens", { token: freshToken(), platform: "ANDROID" }));
      expect(res.status).toBe(401);
    });

    it("[push-token-reject-userid-tamper] a client-supplied userId in the body is rejected outright, never silently accepted or used as ownership", async () => {
      const member = await createVerifiedMember("push-tamper");
      const other = await createVerifiedMember("push-tamper-other");
      const token = freshToken();
      const res = await registerPushToken(
        preq(
          "http://localhost/api/v1/devices/push-tokens",
          { token, platform: "ANDROID", userId: other.userId },
          member.sessionToken
        )
      );
      // .strict() on the schema rejects the unexpected field outright (400)
      // rather than silently stripping it — defense in depth, matching
      // B10's own posture on sensitive write endpoints.
      expect(res.status).toBe(400);
      const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(rows).toHaveLength(0);
    });

    it("[push-token-upsert-idempotent] registering the same token twice updates one row in place, never creates a duplicate", async () => {
      const member = await createVerifiedMember("push-upsert");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));
      const second = await registerPushToken(
        preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken)
      );
      expect(second.status).toBe(201);

      const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(rows).toHaveLength(1);
    });

    it("[push-token-reregister-reassigns-owner] re-registering an existing token under a different (now-current) user reassigns it — a real device can change accounts", async () => {
      const first = await createVerifiedMember("push-reassign-a");
      const second = await createVerifiedMember("push-reassign-b");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, first.sessionToken));
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, second.sessionToken));

      const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(second.userId);
    });

    it("[push-token-list-own-only] listing returns only the caller's own live devices, never another user's", async () => {
      const a = await createVerifiedMember("push-list-a");
      const b = await createVerifiedMember("push-list-b");
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: freshToken(), platform: "ANDROID" }, a.sessionToken));
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: freshToken(), platform: "IOS" }, a.sessionToken));
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: freshToken(), platform: "WEB" }, b.sessionToken));

      const res = await listPushTokens(greq("http://localhost/api/v1/devices/push-tokens", a.sessionToken));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.devices).toHaveLength(2);
      expect(data.devices.every((d: { token?: string }) => d.token === undefined)).toBe(true); // list never echoes the raw token
    });

    it("[push-token-revoke-by-id] revoking by the row's own id marks it revoked and excludes it from future listings", async () => {
      const member = await createVerifiedMember("push-revoke-id");
      const token = freshToken();
      const regRes = await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));
      const { data: regData } = await regRes.json();

      const delRes = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${regData.device.id}`, member.sessionToken), { params: { tokenOrId: regData.device.id, } });
      expect(delRes.status).toBe(200);

      const listRes = await listPushTokens(greq("http://localhost/api/v1/devices/push-tokens", member.sessionToken));
      const { data: listData } = await listRes.json();
      expect(listData.devices).toHaveLength(0);

      const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(row.revokedAt).not.toBeNull();
    });

    it("[push-token-revoke-by-token] revoking by the raw token string works identically to revoking by id", async () => {
      const member = await createVerifiedMember("push-revoke-token");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));

      const delRes = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${token}`, member.sessionToken), { params: { tokenOrId: token, } });
      expect(delRes.status).toBe(200);
      const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token));
      expect(row.revokedAt).not.toBeNull();
    });

    it("[push-token-revoke-idempotent] revoking an already-revoked token is a clean no-op, not an error", async () => {
      const member = await createVerifiedMember("push-revoke-twice");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));
      const first = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${token}`, member.sessionToken), { params: { tokenOrId: token } });
      const second = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${token}`, member.sessionToken), { params: { tokenOrId: token } });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it("[push-token-idor-revoke] User A cannot revoke User B's push token by guessing its id — denied identically to a not-found id", async () => {
      const a = await createVerifiedMember("push-idor-a");
      const b = await createVerifiedMember("push-idor-b");
      const bToken = freshToken();
      const regRes = await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: bToken, platform: "ANDROID" }, b.sessionToken));
      const { data: regData } = await regRes.json();

      const attackRes = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${regData.device.id}`, a.sessionToken), { params: { tokenOrId: regData.device.id, } });
      expect(attackRes.status).toBe(403);

      // B's token must still be live afterward — the attack had zero effect.
      const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, bToken));
      expect(row.revokedAt).toBeNull();
    });

    it("[push-token-idor-revoke-by-token-string] User A cannot revoke User B's token by guessing/knowing its raw token string either", async () => {
      const a = await createVerifiedMember("push-idor-str-a");
      const b = await createVerifiedMember("push-idor-str-b");
      const bToken = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: bToken, platform: "ANDROID" }, b.sessionToken));

      const attackRes = await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${bToken}`, a.sessionToken), { params: { tokenOrId: bToken } });
      expect(attackRes.status).toBe(403);
      const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, bToken));
      expect(row.revokedAt).toBeNull();
    });

    it("[push-token-revoke-nonexistent] revoking an id/token that doesn't exist at all is the same denial, never a 500", async () => {
      const member = await createVerifiedMember("push-revoke-missing");
      const res = await revokePushToken(dreq("http://localhost/api/v1/devices/push-tokens/does-not-exist-token", member.sessionToken), { params: { tokenOrId: "does-not-exist-token", } });
      expect(res.status).toBe(403);
    });
  });

  // --- Addressing wiring into notify() ---------------------------------

  describe("notify() PUSH addressing (device-token lookup path)", () => {
    it("[notify-push-no-device-fails-honestly] with zero registered devices, PUSH notify() fails with the same 'no destination address' shape EMAIL/WHATSAPP use — never a fabricated SENT", async () => {
      const member = await createVerifiedMember("notify-push-none");
      const row = await notify({ userId: member.userId, channel: "PUSH", title: "t", body: "b", devMode: false });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("FAILED");
      expect(row!.failureReason).toMatch(/no destination address/i);
    });

    it("[notify-push-dev-provider-uses-real-token] with a real registered device (devMode true, the test default), notify() actually looks up and sends to the real token via the dev provider — proving the addressing is real, not a stub", async () => {
      const member = await createVerifiedMember("notify-push-dev");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));

      const row = await notify({ userId: member.userId, channel: "PUSH", title: "Hello", body: "World" });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("SENT");

      const stored = getDevNotificationSend("PUSH", token);
      expect(stored).toBeDefined();
      expect(stored!.title).toBe("Hello");
    });

    it("[notify-push-real-provider-fails-configured] with a real registered device but the real (unconfigured) provider forced (devMode:false), notify() FAILS with the provider's own 'not configured' reason — proving it attempted delivery to the resolved token rather than short-circuiting on 'no address'", async () => {
      const member = await createVerifiedMember("notify-push-real");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));

      const row = await notify({ userId: member.userId, channel: "PUSH", title: "t", body: "b", devMode: false });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("FAILED");
      // Distinguishes from the "no destination address" case above — this
      // failure reason comes from PushNotificationProvider itself, only
      // reachable once a real token was found and an actual send was
      // attempted against it.
      expect(row!.failureReason).toMatch(/not configured|no real vendor/i);
      expect(row!.failureReason).not.toMatch(/no destination address/i);
    });

    it("[notify-push-multi-device] a user with two registered devices gets addressed on both — at least one dev-provider 'send' per device", async () => {
      const member = await createVerifiedMember("notify-push-multi");
      const tokenA = freshToken();
      const tokenB = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: tokenA, platform: "ANDROID" }, member.sessionToken));
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token: tokenB, platform: "IOS" }, member.sessionToken));

      const row = await notify({ userId: member.userId, channel: "PUSH", title: "multi", body: "device" });
      expect(row!.deliveryStatus).toBe("SENT");
      expect(getDevNotificationSend("PUSH", tokenA)).toBeDefined();
      expect(getDevNotificationSend("PUSH", tokenB)).toBeDefined();
    });

    it("[notify-push-revoked-excluded] a revoked token is never addressed by notify()", async () => {
      const member = await createVerifiedMember("notify-push-revoked");
      const token = freshToken();
      await registerPushToken(preq("http://localhost/api/v1/devices/push-tokens", { token, platform: "ANDROID" }, member.sessionToken));
      await revokePushToken(dreq(`http://localhost/api/v1/devices/push-tokens/${token}`, member.sessionToken), { params: { tokenOrId: token } });

      const row = await notify({ userId: member.userId, channel: "PUSH", title: "t", body: "b", devMode: false });
      expect(row!.deliveryStatus).toBe("FAILED");
      expect(row!.failureReason).toMatch(/no destination address/i);
    });
  });
});
