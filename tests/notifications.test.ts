/**
 * B7: notification core (notify(), delivery-status tracking, dedupe,
 * provider abstraction) and the real event-generation call sites B7 wires
 * into B6's interactions/warnings services plus B7's own chat service.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { POST as likeUser } from "@/app/api/v1/interactions/likes/route";
import { POST as openChat } from "@/app/api/v1/chats/route";
import { POST as sendMessage } from "@/app/api/v1/chats/[chatId]/messages/route";
import { POST as issueWarning } from "@/app/api/v1/admin/users/[userId]/warnings/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { GET as listNotifications } from "@/app/api/v1/notifications/route";
import { POST as markNotificationRead } from "@/app/api/v1/notifications/[notificationId]/read/route";
import { POST as markAllNotificationsRead } from "@/app/api/v1/notifications/read-all/route";
import { GET as unreadNotificationCount } from "@/app/api/v1/notifications/unread-count/route";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, notifications, warningCategories } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { notify } from "@/server/modules/notifications/notifications.service";
import { getDevNotificationSend, __clearDevNotificationStoreForTests } from "@/server/modules/notifications/providers/dev.provider";
import { getNotificationProvider } from "@/server/modules/notifications/providers/factory";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetMatchingWeightsForTests,
  activateMembershipForTests,
} from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function ireq(url: string, body: unknown, token: string, method = "POST") {
  return req(url, body, { token, method });
}
function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

/** B8 note: sendInterest now requires the SENDER to have an active
 * membership (see interactions.service.ts's pre-approved B8 touch,
 * documented in BACKEND.md's B8 section). This file's own subject is
 * notification delivery/event-generation, not membership gating, so both
 * users get a test-fixture ACTIVE membership up front — every existing
 * assertion below is preserved unweakened; only the fixture setup gained
 * this one additive call. */
async function twoReadyUsers(refs: ReferenceIds, prefix: string) {
  const a = await buildReadyProfile(`${prefix}-a`, refs, { gender: "FEMALE" });
  const b = await buildReadyProfile(`${prefix}-b`, refs, { gender: "MALE" });
  await activateMembershipForTests(a.member.userId);
  await activateMembershipForTests(b.member.userId);
  return { a, b };
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `notif-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Notif Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

async function notificationsFor(userId: string) {
  return db.select().from(notifications).where(eq(notifications.userId, userId));
}

describe("B7 notifications", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
    __clearDevNotificationStoreForTests();
    refs = await resolveReferenceIds();
  });

  // --- notify() core -------------------------------------------------------

  describe("notify() core", () => {
    it("[notify-in-app] an IN_APP notification is DELIVERED immediately — the row's existence IS the delivery", async () => {
      const { a } = await twoReadyUsers(refs, "notify-inapp");
      const row = await notify({ userId: a.member.userId, channel: "IN_APP", title: "Hello", body: "World" });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("DELIVERED");
      expect(row!.deliveredAt).not.toBeNull();
      expect(row!.channel).toBe("IN_APP");
    });

    it("[notify-dedupe] two notify() calls with the same dedupeKey produce exactly one row", async () => {
      const { a } = await twoReadyUsers(refs, "notify-dedupe");
      const first = await notify({ userId: a.member.userId, channel: "IN_APP", title: "t1", body: "b1", dedupeKey: "dedupe-test-1" });
      const second = await notify({ userId: a.member.userId, channel: "IN_APP", title: "t2", body: "b2", dedupeKey: "dedupe-test-1" });
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // the deduped no-op
      const rows = await db.select().from(notifications).where(eq(notifications.dedupeKey, "dedupe-test-1"));
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("t1"); // the FIRST call's row, unchanged
    });

    it("[notify-no-dedupe-key] omitting dedupeKey never blocks separate notifications", async () => {
      const { a } = await twoReadyUsers(refs, "notify-nodedupe");
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "t1", body: "b1" });
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "t2", body: "b2" });
      const rows = await notificationsFor(a.member.userId);
      expect(rows).toHaveLength(2);
    });

    it("[notify-sent-via-dev-provider] EMAIL with devMode true (the default under NODE_ENV=test) reaches the dev provider and is SENT, never fabricating DELIVERED", async () => {
      const { a } = await twoReadyUsers(refs, "notify-devsend");
      const row = await notify({ userId: a.member.userId, channel: "EMAIL", title: "Dev send", body: "Dev body" });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("SENT");
      expect(row!.deliveredAt).toBeNull(); // SENT never implies a delivery receipt
      const stored = getDevNotificationSend("EMAIL", a.member.email);
      expect(stored).toBeDefined();
      expect(stored!.title).toBe("Dev send");
    });

    it("[notify-failed-real-provider] an unconfigured real provider (devMode override false — no EMAIL_PROVIDER set in .env.test) produces FAILED, never a fabricated SENT/DELIVERED", async () => {
      const { a } = await twoReadyUsers(refs, "notify-failed");
      const row = await notify({ userId: a.member.userId, channel: "EMAIL", title: "Real send", body: "x", devMode: false });
      expect(row).not.toBeNull();
      expect(row!.deliveryStatus).toBe("FAILED");
      expect(row!.deliveredAt).toBeNull();
      expect(row!.failureReason).toBeTruthy();
      expect(row!.failureReason).not.toMatch(/EMAIL_API_KEY=|apikey|secret/i); // never leaks a credential value
    });

    it("[provider-factory-devmode] the factory returns the dev provider only when devMode=true (outside production) and the real provider otherwise", async () => {
      const devProvider = getNotificationProvider("EMAIL", true);
      expect(devProvider.constructor.name).toBe("DevNotificationProvider");
      const realProvider = getNotificationProvider("EMAIL", false);
      expect(realProvider.constructor.name).toBe("EmailNotificationProvider");
      expect(realProvider.isConfigured()).toBe(false); // no EMAIL_PROVIDER/EMAIL_API_KEY in .env.test
      await expect(realProvider.send({ to: "x@example.com", title: "t", body: "b" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });
  });

  // --- Member-facing list / read state --------------------------------------

  describe("List / read state", () => {
    it("[notify-list-pagination] lists a user's own notifications, newest first, paginated", async () => {
      const { a } = await twoReadyUsers(refs, "notify-list");
      for (let i = 1; i <= 3; i++) {
        await notify({ userId: a.member.userId, channel: "IN_APP", title: `n${i}`, body: "x" });
      }
      const res = await listNotifications(greq("http://localhost/api/v1/notifications?page=1&pageSize=2", a.member.sessionToken));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.total).toBe(3);
      expect(data.items).toHaveLength(2);
      expect(data.items[0].title).toBe("n3"); // newest first
    });

    it("[notify-mark-read] marks one notification read, idempotently", async () => {
      const { a } = await twoReadyUsers(refs, "notify-markread");
      const row = await notify({ userId: a.member.userId, channel: "IN_APP", title: "n", body: "x" });
      const res = await markNotificationRead(ireq(`http://localhost/api/v1/notifications/${row!.id}/read`, undefined, a.member.sessionToken), {
        params: { notificationId: row!.id },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.notification.isRead).toBe(true);

      const again = await markNotificationRead(ireq(`http://localhost/api/v1/notifications/${row!.id}/read`, undefined, a.member.sessionToken), {
        params: { notificationId: row!.id },
      });
      expect(again.status).toBe(200);
    });

    it("[notify-idor] a different user cannot mark someone else's notification as read", async () => {
      const { a, b } = await twoReadyUsers(refs, "notify-idor");
      const row = await notify({ userId: a.member.userId, channel: "IN_APP", title: "n", body: "x" });
      const res = await markNotificationRead(ireq(`http://localhost/api/v1/notifications/${row!.id}/read`, undefined, b.member.sessionToken), {
        params: { notificationId: row!.id },
      });
      expect(res.status).toBe(403);
    });

    it("[notify-mark-all-read] bulk-marks every unread notification for the caller only", async () => {
      const { a, b } = await twoReadyUsers(refs, "notify-markall");
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "n1", body: "x" });
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "n2", body: "x" });
      await notify({ userId: b.member.userId, channel: "IN_APP", title: "n3", body: "x" });

      const res = await markAllNotificationsRead(ireq("http://localhost/api/v1/notifications/read-all", undefined, a.member.sessionToken));
      const { data } = await res.json();
      expect(data.updated).toBe(2);

      const bUnread = await unreadNotificationCount(greq("http://localhost/api/v1/notifications/unread-count", b.member.sessionToken));
      const { data: bData } = await bUnread.json();
      expect(bData.count).toBe(1); // b's own notification untouched
    });

    it("[notify-unread-count] reflects only this user's unread notifications", async () => {
      const { a } = await twoReadyUsers(refs, "notify-unreadcount");
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "n1", body: "x" });
      await notify({ userId: a.member.userId, channel: "IN_APP", title: "n2", body: "x" });
      const res = await unreadNotificationCount(greq("http://localhost/api/v1/notifications/unread-count", a.member.sessionToken));
      const { data } = await res.json();
      expect(data.count).toBe(2);
    });
  });

  // --- Real event-generation call sites -----------------------------------

  describe("Event generation", () => {
    it("[event-interest-received] sending an interest notifies the recipient (not the sender)", async () => {
      const { a, b } = await twoReadyUsers(refs, "ev-interest");
      await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));

      const bRows = await notificationsFor(b.member.userId);
      expect(bRows).toHaveLength(1);
      expect(bRows[0].title).toMatch(/interest/i);
      expect(bRows[0].channel).toBe("IN_APP");
      expect(bRows[0].deliveryStatus).toBe("DELIVERED");

      const aRows = await notificationsFor(a.member.userId);
      expect(aRows).toHaveLength(0);
    });

    it("[event-interest-accepted-and-match] accepting produces an interest-accepted notification for the original sender and a match-created notification for both", async () => {
      const { a, b } = await twoReadyUsers(refs, "ev-accept");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );

      const aRows = await notificationsFor(a.member.userId);
      // a sent the interest, so a gets: interest-accepted + new-match (the
      // interest_received notification never fires for one's own send).
      expect(aRows.some((r) => /accepted/i.test(r.title))).toBe(true);
      expect(aRows.some((r) => /match/i.test(r.title))).toBe(true);

      const bRows = await notificationsFor(b.member.userId);
      // b received+accepted the interest: interest_received (from the
      // send) + new-match (from the accept). No "interest accepted" for
      // b, since b is the accepter, not the one whose interest changed.
      expect(bRows.some((r) => /match/i.test(r.title))).toBe(true);
      expect(bRows.some((r) => /accepted/i.test(r.title))).toBe(false);
    });

    it("[event-interest-rejected] rejecting notifies the original sender", async () => {
      const { a, b } = await twoReadyUsers(refs, "ev-reject");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "DECLINED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );

      const aRows = await notificationsFor(a.member.userId);
      expect(aRows.some((r) => /declined|rejected/i.test(r.title))).toBe(true);
    });

    it("[event-like-received] liking a profile notifies the recipient, deduplicated on a repeat like", async () => {
      const { a, b } = await twoReadyUsers(refs, "ev-like");
      await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken)); // duplicate

      const bRows = await notificationsFor(b.member.userId);
      expect(bRows).toHaveLength(1);
      expect(bRows[0].title).toMatch(/like/i);
    });

    it("[event-warning-issued] an admin issuing a warning notifies the recipient", async () => {
      const { a } = await twoReadyUsers(refs, "ev-warning");
      const [cat] = await db.select().from(warningCategories).limit(1);
      const superToken = await seedAdmin("SUPER_ADMIN");

      await issueWarning(
        ireq(`http://localhost/api/v1/admin/users/${a.member.userId}/warnings`, { categoryId: cat.id, message: "Please follow the rules." }, superToken),
        { params: { userId: a.member.userId } }
      );

      const rows = await notificationsFor(a.member.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toMatch(/warning/i);
      expect(rows[0].body).toBe("Please follow the rules.");
    });

    it("[event-new-chat-message] sending a chat message notifies the counterpart, not the sender", async () => {
      const { a, b } = await twoReadyUsers(refs, "ev-chatmsg");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();
      await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      await activateMembershipForTests(a.member.userId);
      const chatRes = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
      const { data: chatData } = await chatRes.json();

      await sendMessage(ireq(`http://localhost/api/v1/chats/${chatData.chat.id}/messages`, { body: "Hey!" }, a.member.sessionToken), {
        params: { chatId: chatData.chat.id },
      });

      const bRows = await notificationsFor(b.member.userId);
      const chatNotif = bRows.find((r) => /message/i.test(r.title));
      expect(chatNotif).toBeDefined();

      const aRows = await notificationsFor(a.member.userId);
      expect(aRows.some((r) => /message/i.test(r.title))).toBe(false); // sender never notifies self
    });
  });
});
