/**
 * Production Completion Phase — notification adapters (SMTP e-mail, WhatsApp Cloud API,
 * FCM HTTP v1). Real adapters against contract mocks. In-app is covered by frozen B7 tests.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const keys = vi.hoisted(() => {
  const crypto = process.getBuiltinModule("crypto");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45874";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-secret-xyz";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
  process.env.WHATSAPP_API_KEY = "wa-access-token-abcdef";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1029384756";
  process.env.WHATSAPP_TEMPLATE_NAME = "member_update";
  process.env.WHATSAPP_API_BASE = "http://127.0.0.1:45875";
  process.env.FCM_PROJECT_ID = "rz-test-project";
  process.env.FCM_CLIENT_EMAIL = "fcm@rz-test-project.iam.gserviceaccount.com";
  process.env.FCM_PRIVATE_KEY = (privateKey as string).replace(/\n/g, "\\n");
  process.env.FCM_API_BASE = "http://127.0.0.1:45876";
  process.env.FCM_TOKEN_URL = "http://127.0.0.1:45876/token";
  return { publicKey: publicKey as string };
});

import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { devicePushTokens, notifications } from "@/server/db/schema";
import { notify } from "@/server/modules/notifications/notifications.service";
import { __resetMailerForTests } from "@/server/lib/mailer";
import { __clearFcmTokenCacheForTests } from "@/server/modules/notifications/providers/push.provider";
import { resetTransactionalTables } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { startMockSmtp, type MockSmtp } from "./helpers/mock-otp";
import { startMockFcm, startMockWhatsApp } from "./helpers/mock-notify";

let smtp: MockSmtp;
let wa: Awaited<ReturnType<typeof startMockWhatsApp>>;
let fcm: Awaited<ReturnType<typeof startMockFcm>>;

beforeAll(async () => {
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-secret-xyz" });
  wa = await startMockWhatsApp({ accessToken: "wa-access-token-abcdef", phoneNumberId: "1029384756" });
  fcm = await startMockFcm({ clientEmail: "fcm@rz-test-project.iam.gserviceaccount.com", publicKeyPem: keys.publicKey, projectId: "rz-test-project" });
});
afterAll(async () => {
  __resetMailerForTests();
  await Promise.all([smtp.close(), wa.close(), fcm.close()]);
});
beforeEach(async () => {
  await resetTransactionalTables();
  __resetMailerForTests();
  __clearFcmTokenCacheForTests();
  smtp.mails.length = 0;
  smtp.rejectNext = false;
  wa.calls.length = 0;
  wa.failNext = 0;
  fcm.sends.length = 0;
  fcm.tokenRequests = 0;
  fcm.unregistered.clear();
  fcm.failNext = 0;
});

const send = (userId: string, channel: "EMAIL" | "WHATSAPP" | "PUSH", title = "Hello", body = "You have a new interest") =>
  notify({ userId, channel, title, body, devMode: false });

describe("EMAIL (SMTP)", () => {
  it("[notif-email-sent] delivers through SMTP and marks the row SENT", async () => {
    const m = await createVerifiedMember("notif-email");
    const row = await send(m.userId, "EMAIL", "New interest", "Someone is interested in you");
    expect(row?.deliveryStatus).toBe("SENT");
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0].to).toEqual([m.email]);
    expect(smtp.mails[0].subject).toBe("New interest");
    expect(smtp.mails[0].text).toContain("Someone is interested in you");
  });

  it("[notif-email-failure-honest] an SMTP rejection marks the row FAILED with a non-secret reason (never SENT)", async () => {
    const m = await createVerifiedMember("notif-email-fail");
    smtp.rejectNext = true;
    const row = await send(m.userId, "EMAIL");
    expect(row?.deliveryStatus).toBe("FAILED");
    expect(row?.failureReason ?? "").not.toMatch(/smtp-pass|secret|550/i);
  });
});

describe("WHATSAPP (Cloud API)", () => {
  it("[notif-wa-sent] posts an approved-template message to the member's number", async () => {
    const m = await createVerifiedMember("notif-wa");
    const row = await send(m.userId, "WHATSAPP", "Match!", "You have a new match");
    expect(row?.deliveryStatus).toBe("SENT");
    expect(wa.calls).toHaveLength(1);
    const b = wa.calls[0].body as { to: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } };
    expect(b.to).toMatch(/^91\d{10}$/);
    expect(b.template.name).toBe("member_update");
    expect(b.template.components[0].parameters.map((p) => p.text)).toEqual(["Match!", "You have a new match"]);
  });

  it("[notif-wa-failure-honest] vendor error → FAILED, no token in the stored reason", async () => {
    const m = await createVerifiedMember("notif-wa-fail");
    wa.failNext = 500;
    const row = await send(m.userId, "WHATSAPP");
    expect(row?.deliveryStatus).toBe("FAILED");
    expect(row?.failureReason ?? "").not.toContain("wa-access-token");
  });
});

describe("PUSH (FCM HTTP v1)", () => {
  async function register(userId: string, token: string) {
    await db.insert(devicePushTokens).values({ userId, token, platform: "ANDROID" });
  }

  it("[notif-push-sent] authenticates with a signed service-account JWT, sends to every live token, caches the access token", async () => {
    const m = await createVerifiedMember("notif-push");
    await register(m.userId, "fcm-token-device-1-aaaaaaaa");
    await register(m.userId, "fcm-token-device-2-bbbbbbbb");
    const row = await send(m.userId, "PUSH", "Chat", "New message");
    expect(row?.deliveryStatus).toBe("SENT");
    expect(fcm.sends.map((s) => s.token).sort()).toEqual(["fcm-token-device-1-aaaaaaaa", "fcm-token-device-2-bbbbbbbb"]);
    expect(fcm.tokenRequests).toBe(1);
    await send(m.userId, "PUSH", "Chat", "Another");
    expect(fcm.tokenRequests).toBe(1);
  });

  it("[notif-push-unregistered-token-revoked] a dead device token is revoked; if every token fails the row is FAILED", async () => {
    const m = await createVerifiedMember("notif-push-dead");
    await register(m.userId, "fcm-token-dead-cccccccc");
    fcm.unregistered.add("fcm-token-dead-cccccccc");
    const row = await send(m.userId, "PUSH");
    expect(row?.deliveryStatus).toBe("FAILED");
    const [t] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, m.userId));
    expect(t.revokedAt).not.toBeNull();
  });

  it("[notif-push-no-token] a member with no registered device gets FAILED (nothing fabricated)", async () => {
    const m = await createVerifiedMember("notif-push-none");
    const row = await send(m.userId, "PUSH");
    expect(row?.deliveryStatus).toBe("FAILED");
    expect(fcm.sends).toHaveLength(0);
  });
});

describe("IN_APP + fail-closed config", () => {
  it("[notif-inapp] in-app is delivered without any provider", async () => {
    const m = await createVerifiedMember("notif-inapp");
    const row = await notify({ userId: m.userId, channel: "IN_APP", title: "Hi", body: "there" });
    expect(row?.deliveryStatus).toBe("DELIVERED");
    expect((await db.select().from(notifications).where(eq(notifications.userId, m.userId))).length).toBe(1);
  });

  it("[notif-unconfigured-fails-closed] with no credentials each real adapter refuses (503) and isConfigured() is false", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("WHATSAPP_API_KEY", "");
    vi.stubEnv("FCM_PROJECT_ID", "");
    vi.resetModules();
    const { EmailNotificationProvider } = await import("@/server/modules/notifications/providers/email.provider");
    const { WhatsAppNotificationProvider } = await import("@/server/modules/notifications/providers/whatsapp.provider");
    const { PushNotificationProvider } = await import("@/server/modules/notifications/providers/push.provider");
    for (const p of [new EmailNotificationProvider(), new WhatsAppNotificationProvider(), new PushNotificationProvider()]) {
      expect(p.isConfigured()).toBe(false);
      await expect(p.send({ to: "x", title: "t", body: "b" })).rejects.toMatchObject({ statusCode: 503 });
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
