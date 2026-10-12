/**
 * B19 — weekly member digest. Runs against the protocol mock SMTP server (no real mail host is contacted).
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45874";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-secret-xyz";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
});

import { eq } from "drizzle-orm";
import { PATCH as patchPrefs, GET as getPrefs } from "@/app/api/v1/users/me/notification-preferences/route";
import { PATCH as patchControls } from "@/app/api/v1/admin/site-controls/route";
import { db } from "@/server/db/client";
import { auditLogs, digestLog, interests, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __resetMailerForTests } from "@/server/lib/mailer";
import { runMemberDigest, buildDigestMail } from "@/server/jobs/definitions/digest";
import { getJob } from "@/server/jobs/registry";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables } from "./helpers/pcp";
import { startMockSmtp, type MockSmtp } from "./helpers/mock-otp";

const U = "http://localhost/api/v1";
let smtp: MockSmtp;

beforeAll(async () => {
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-secret-xyz" });
});
afterAll(async () => {
  __resetMailerForTests();
  await smtp.close();
});
beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  smtp.mails.length = 0;
  smtp.rejectNext = false;
});

const setPrefs = (token: string, body: unknown) => patchPrefs(req(`${U}/users/me/notification-preferences`, body, { token, method: "PATCH" }));
async function interestFor(toUserId: string, prefix: string) {
  const from = await createVerifiedMember(prefix);
  await db.insert(interests).values({ fromUserId: from.userId, toUserId });
}

describe("member preference", () => {
  it("[dg-pref] DIGEST is opt-in (false by default), can be switched on and off, and is validated", async () => {
    const m = await createVerifiedMember("dg-pref");
    const read = async () => (await (await getPrefs(req(`${U}/users/me/notification-preferences`, undefined, { token: m.sessionToken, method: "GET" }))).json()).data.preferences;
    expect((await read()).DIGEST).toBe(false);
    expect((await setPrefs(m.sessionToken, { DIGEST: true })).status).toBe(200);
    expect((await read()).DIGEST).toBe(true);
    expect((await setPrefs(m.sessionToken, { DIGEST: "yes" })).status).toBe(400);
    expect((await setPrefs(m.sessionToken, { DIGEST: false })).status).toBe(200);
    expect((await read()).DIGEST).toBe(false);
  });
});

describe("digest job", () => {
  it("[dg-send] sends one mail to an opted-in member with something new, with counts only, and never twice in the same week", async () => {
    const m = await createVerifiedMember("dg-send");
    await setPrefs(m.sessionToken, { DIGEST: true });
    await interestFor(m.userId, "dg-send-from1");
    await interestFor(m.userId, "dg-send-from2");

    const first = await runMemberDigest();
    expect(first).toMatchObject({ sent: 1, failed: 0, skipped: false });
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0].to).toEqual([m.email]);
    expect(smtp.mails[0].subject).toMatch(/weekly/i);
    expect(smtp.mails[0].text).toMatch(/2 interests waiting/);
    expect(smtp.mails[0].text).toMatch(/Settings/);

    const again = await runMemberDigest();
    expect(again).toMatchObject({ sent: 0, empty: 0 });
    expect(smtp.mails).toHaveLength(1);
    const log = await db.select().from(digestLog).where(eq(digestLog.userId, m.userId));
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe("SENT");
  });

  it("[dg-skip] not opted in, E-mail channel off, inactive account, or nothing new => no mail (EMPTY is logged)", async () => {
    const noOpt = await createVerifiedMember("dg-noopt");
    await interestFor(noOpt.userId, "dg-noopt-from");

    const emailOff = await createVerifiedMember("dg-emailoff");
    await setPrefs(emailOff.sessionToken, { DIGEST: true, EMAIL: false });
    await interestFor(emailOff.userId, "dg-emailoff-from");

    const inactive = await createVerifiedMember("dg-inactive");
    await setPrefs(inactive.sessionToken, { DIGEST: true });
    await interestFor(inactive.userId, "dg-inactive-from");
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, inactive.userId));

    const quiet = await createVerifiedMember("dg-quiet");
    await setPrefs(quiet.sessionToken, { DIGEST: true });

    const stats = await runMemberDigest();
    expect(stats).toMatchObject({ sent: 0, empty: 1, failed: 0 });
    expect(smtp.mails).toHaveLength(0);
    expect((await db.select().from(digestLog).where(eq(digestLog.userId, quiet.userId)))[0].status).toBe("EMPTY");
  });

  it("[dg-master] the Super Admin master switch turns every digest off, and it is audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const m = await createVerifiedMember("dg-master");
    await setPrefs(m.sessionToken, { DIGEST: true });
    await interestFor(m.userId, "dg-master-from");

    const off = await patchControls(jreq(`${U}/admin/site-controls`, { method: "PATCH", body: { digest: { enabled: false } }, token: sup.token }));
    expect(off.status).toBe(200);
    expect((await off.json()).data.digest.enabled).toBe(false);
    expect(await runMemberDigest()).toMatchObject({ sent: 0, skipped: true });
    expect(smtp.mails).toHaveLength(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "settings.digest_changed"))).length).toBe(1);

    await patchControls(jreq(`${U}/admin/site-controls`, { method: "PATCH", body: { digest: { enabled: true } }, token: sup.token }));
    expect(await runMemberDigest()).toMatchObject({ sent: 1 });
  });

  it("[dg-retry] an SMTP refusal is recorded FAILED and retried by the next run, with exactly one mail in the end", async () => {
    const m = await createVerifiedMember("dg-retry");
    await setPrefs(m.sessionToken, { DIGEST: true });
    await interestFor(m.userId, "dg-retry-from");
    smtp.rejectNext = true;
    expect(await runMemberDigest()).toMatchObject({ sent: 0, failed: 1 });
    expect((await db.select().from(digestLog).where(eq(digestLog.userId, m.userId)))[0].status).toBe("FAILED");
    expect(await runMemberDigest()).toMatchObject({ sent: 1, failed: 0 });
    expect(smtp.mails).toHaveLength(1);
  });

  it("[dg-overlap] two overlapping runs send one mail", async () => {
    const m = await createVerifiedMember("dg-overlap");
    await setPrefs(m.sessionToken, { DIGEST: true });
    await interestFor(m.userId, "dg-overlap-from");
    const [a, b] = await Promise.all([runMemberDigest(), runMemberDigest()]);
    expect(Number(a.sent) + Number(b.sent)).toBe(1);
    expect(smtp.mails).toHaveLength(1);
  });

  it("[dg-registry] is registered as member-digest; mail builder escapes names and singularises", () => {
    expect(getJob("member-digest")?.suggestedSchedule).toBeTruthy();
    const mail = buildDigestMail({ name: '<b>Eve</b> "X"', pending: 1, matches: 1, unread: 1 }, "https://example.test/");
    expect(mail.html).not.toContain("<b>");
    expect(mail.text).toMatch(/1 interest waiting/);
    expect(mail.text).toMatch(/1 new match this week/);
    expect(mail.text).toMatch(/1 unread message\b/);
    expect(mail.text).toContain("https://example.test/dashboard");
  });
});

describe("without SMTP", () => {
  it("[dg-nosmtp] is reported as skipped and claims nothing", async () => {
    vi.resetModules();
    const saved = { host: process.env.SMTP_HOST, from: process.env.EMAIL_FROM };
    delete process.env.SMTP_HOST;
    delete process.env.EMAIL_FROM;
    try {
      const mod = await import("@/server/jobs/definitions/digest");
      // env is memoised per module graph; a fresh import reads the cleared variables
      const stats = await mod.runMemberDigest();
      expect(stats).toMatchObject({ sent: 0, skipped: true });
    } finally {
      process.env.SMTP_HOST = saved.host;
      process.env.EMAIL_FROM = saved.from;
      vi.resetModules();
    }
  });
});
