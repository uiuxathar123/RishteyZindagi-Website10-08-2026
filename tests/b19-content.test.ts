/**
 * B19 — contact inbox, support contact details, CMS success stories.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as submit } from "@/app/api/v1/contact/route";
import { GET as publicContact } from "@/app/api/v1/support-contact/route";
import { GET as publicStories } from "@/app/api/v1/success-stories/route";
import { GET as adminContact, PATCH as patchContact } from "@/app/api/v1/admin/support-contact/route";
import { GET as listMessages } from "@/app/api/v1/admin/contact-messages/route";
import { PATCH as patchMessage } from "@/app/api/v1/admin/contact-messages/[messageId]/route";
import { GET as listStories, POST as createStoryRoute } from "@/app/api/v1/admin/success-stories/route";
import { PATCH as patchStoryRoute, DELETE as deleteStoryRoute } from "@/app/api/v1/admin/success-stories/[storyId]/route";
import { db } from "@/server/db/client";
import { auditLogs, contactMessages } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const U = "http://localhost/api/v1";
const msg = { name: "Asha Rao", email: "asha@example.com", topic: "ACCOUNT", subject: "Cannot log in", message: "I cannot log in since yesterday, please help." };
const post = (body: unknown, ip = "10.0.0.1") => submit(jreq(`${U}/contact`, { body, headers: { "x-forwarded-for": ip } }));
const story = { coupleNames: "Priya & Rahul", location: "Pune", year: 2025, story: "We met through RishteyZindagi and married after a year of getting to know each other.", consentConfirmed: true, isPublished: true };

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("contact form", () => {
  it("[ct-submit] anonymous submit is stored; invalid and oversize input is rejected; honeypot stores nothing; rate limited", async () => {
    expect((await post(msg)).status).toBe(200);
    const rows = await db.select().from(contactMessages);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("NEW");
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0].ipHash).not.toContain("10.0.0.1");

    expect((await post({ ...msg, email: "not-an-email" }, "10.0.0.2")).status).toBe(400);
    expect((await post({ ...msg, message: "short" }, "10.0.0.2")).status).toBe(400);
    expect((await post({ ...msg, message: "x".repeat(3001) }, "10.0.0.2")).status).toBe(400);
    expect((await post({ ...msg, extra: 1 }, "10.0.0.2")).status).toBe(400);
    expect((await post({ ...msg, topic: "HACK" }, "10.0.0.2")).status).toBe(400);

    expect((await post({ ...msg, email: "bot@example.com", website: "http://spam" }, "10.0.0.3")).status).toBe(200); // told "received"
    expect((await db.select().from(contactMessages)).length).toBe(1); // …but nothing stored

    for (let i = 0; i < 5; i++) await post({ ...msg, email: `u${i}@example.com` }, "10.0.0.9");
    expect((await post({ ...msg, email: "u9@example.com" }, "10.0.0.9")).status).toBe(429);
  });
});

describe("admin inbox + support contact", () => {
  it("[ct-authz] needs support.manage; staff gains and loses it live; members and anonymous are refused", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const member = await createVerifiedMember("ct-member");
    await post(msg);
    const list = (t?: string) => listMessages(jreq(`${U}/admin/contact-messages`, { token: t }));
    expect((await list()).status).toBe(401);
    expect([401, 403]).toContain((await list(member.sessionToken)).status);
    expect((await list(staff.token)).status).toBe(403);
    expect((await patchContact(jreq(`${U}/admin/support-contact`, { method: "PATCH", token: staff.token, body: { email: "", phone: "", hours: "" } }))).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "support.manage");
    expect((await list(staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "support.manage");
    expect((await list(staff.token)).status).toBe(403);
    expect((await (await list(sup.token)).json()).data.total).toBe(1);
  });

  it("[ct-triage] list, filter, mark read/resolved with a note; audited; bad ids/status rejected", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    await post(msg);
    const l = await (await listMessages(jreq(`${U}/admin/contact-messages?status=NEW`, { token: sup.token }))).json();
    expect(l.data.newCount).toBe(1);
    const id = l.data.items[0].id;
    const upd = (body: unknown, mid = id) => patchMessage(jreq(`${U}/admin/contact-messages/${mid}`, { method: "PATCH", token: sup.token, body }), { params: { messageId: mid } });
    expect((await upd({ status: "BOGUS" })).status).toBe(400);
    expect((await upd({})).status).toBe(400);
    expect((await upd({ status: "RESOLVED" }, "not-a-uuid")).status).toBe(404);
    const done = await (await upd({ status: "RESOLVED", adminNote: "Reset link sent" })).json();
    expect(done.data.status).toBe("RESOLVED");
    expect(done.data.adminNote).toBe("Reset link sent");
    expect((await (await listMessages(jreq(`${U}/admin/contact-messages`, { token: sup.token }))).json()).data.newCount).toBe(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "contact.message_updated"))).length).toBe(1);
  });

  it("[ct-support-details] public page shows only what an admin entered; validation; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    expect((await (await publicContact(jreq(`${U}/support-contact`))).json()).data).toEqual({ email: "", phone: "", hours: "" });
    const bad = await patchContact(jreq(`${U}/admin/support-contact`, { method: "PATCH", token: sup.token, body: { email: "nope", phone: "abc", hours: "" } }));
    expect(bad.status).toBe(400);
    const good = await patchContact(jreq(`${U}/admin/support-contact`, { method: "PATCH", token: sup.token, body: { email: "Help@Example.com", phone: "+91 98765 43210", hours: "Mon–Sat 10am–6pm" } }));
    expect(good.status).toBe(200);
    expect((await (await publicContact(jreq(`${U}/support-contact`))).json()).data.email).toBe("help@example.com");
    expect((await adminContact(jreq(`${U}/admin/support-contact`, { token: sup.token }))).status).toBe(200);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "settings.support_contact_changed"))).length).toBe(1);
  });
});

describe("success stories", () => {
  it("[st-flow] needs content.manage; publishing needs consent; only published+consented stories are public; edit/unpublish/delete work; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const create = (t: string | undefined, body: unknown) => createStoryRoute(jreq(`${U}/admin/success-stories`, { token: t, body }));
    expect((await create(undefined, story)).status).toBe(401);
    expect((await create(staff.token, story)).status).toBe(403);
    expect((await listStories(jreq(`${U}/admin/success-stories`, { token: staff.token }))).status).toBe(403);

    expect((await create(sup.token, { ...story, consentConfirmed: false })).status).toBe(409); // publish without consent
    expect((await create(sup.token, { ...story, story: "too short" })).status).toBe(400);
    expect((await create(sup.token, { ...story, year: 1850 })).status).toBe(400);
    const draftRes = await create(sup.token, { ...story, isPublished: false, consentConfirmed: false });
    expect(draftRes.status).toBe(200);
    const draft = (await draftRes.json()).data;
    expect((await (await publicStories(jreq(`${U}/success-stories`))).json()).data.stories).toEqual([]); // drafts are private

    const upd = (id: string, body: unknown, t = sup.token) => patchStoryRoute(jreq(`${U}/admin/success-stories/${id}`, { method: "PATCH", token: t, body }), { params: { storyId: id } });
    expect((await upd(draft.id, { isPublished: true })).status).toBe(409); // still no consent
    expect((await upd(draft.id, { isPublished: true, consentConfirmed: true })).status).toBe(200);
    const pub = (await (await publicStories(jreq(`${U}/success-stories`))).json()).data.stories;
    expect(pub.length).toBe(1);
    expect(pub[0].coupleNames).toBe("Priya & Rahul");
    expect(Object.keys(pub[0]).sort()).toEqual(["coupleNames", "id", "location", "story", "year"]);

    // regression: a partial edit must not reset other fields (zod .partial() + .default() would un-publish and zero the order)
    expect((await upd(draft.id, { sortOrder: 7 })).status).toBe(200);
    expect((await upd(draft.id, { year: 2024 })).status).toBe(200);
    const kept = (await (await listStories(jreq(`${U}/admin/success-stories`, { token: sup.token }))).json()).data.stories[0];
    expect(kept).toMatchObject({ isPublished: true, consentConfirmed: true, sortOrder: 7, year: 2024 });

    expect((await upd(draft.id, { isPublished: false })).status).toBe(200);
    expect((await (await publicStories(jreq(`${U}/success-stories`))).json()).data.stories).toEqual([]);
    expect((await upd("not-a-uuid", { year: 2024 })).status).toBe(404);
    expect((await upd(draft.id, {})).status).toBe(400);

    const del = (id: string) => deleteStoryRoute(jreq(`${U}/admin/success-stories/${id}`, { method: "DELETE", token: sup.token }), { params: { storyId: id } });
    expect((await del(draft.id)).status).toBe(200);
    expect((await del(draft.id)).status).toBe(404);
    const actions = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["story.created", "story.updated", "story.deleted"]));
  });
});
