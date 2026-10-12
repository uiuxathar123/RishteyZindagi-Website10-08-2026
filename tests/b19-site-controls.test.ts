/**
 * B19 — Super-Admin site controls: maintenance mode and manual profile approval.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getControls, PATCH as patchControls } from "@/app/api/v1/admin/site-controls/route";
import { GET as siteStatus } from "@/app/api/v1/site-status/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as getProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { GET as myProfile, PATCH as patchMyProfile } from "@/app/api/v1/profiles/me/route";
import { GET as listApprovals } from "@/app/api/v1/admin/profile-approvals/route";
import { POST as decide } from "@/app/api/v1/admin/profile-approvals/[profileId]/route";
import { GET as adminMe } from "@/app/api/v1/admin/me/route";
import { db } from "@/server/db/client";
import { auditLogs, profiles } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { isMaintenanceExempt } from "@/server/middleware/maintenance";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1";
const patch = (token: string | undefined, body: unknown) => patchControls(jreq(`${URL_}/admin/site-controls`, { method: "PATCH", body, token }));
const read = (token?: string) => getControls(jreq(`${URL_}/admin/site-controls`, { token }));
const search = (token?: string) => searchProfiles(req(`${URL_}/search/profiles?gender=FEMALE`, undefined, { token, method: "GET" }));
const view = (id: string, token?: string) => getProfile(req(`${URL_}/profiles/${id}`, undefined, { token, method: "GET" }), { params: { profileId: id } });
const queue = (token: string | undefined, status = "PENDING") => listApprovals(jreq(`${URL_}/admin/profile-approvals?status=${status}`, { token }));
const decideOn = (token: string | undefined, id: string, body: unknown) =>
  decide(jreq(`${URL_}/admin/profile-approvals/${id}`, { method: "POST", body, token }), { params: { profileId: id } });

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers(); // clears platform_settings
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("authorization", () => {
  it("[sc-authz] only the Super Admin can read or change site controls (staff, even with platform.settings.manage, and members cannot)", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    await grantPermission("STAFF_ADMIN", "platform.settings.manage");
    const refs = await resolveReferenceIds();
    const member = await buildReadyProfile("sc-authz", refs);
    expect((await read()).status).toBe(401);
    expect((await patch(undefined, { approval: { manualApproval: true } })).status).toBe(401);
    for (const t of [staff.token, member.member.sessionToken]) {
      expect([401, 403]).toContain((await read(t)).status);
      expect([401, 403]).toContain((await patch(t, { approval: { manualApproval: true } })).status);
    }
    expect((await read(sup.token)).status).toBe(200);
    expect((await patch(sup.token, { approval: { manualApproval: true } })).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "platform.settings.manage");
  });

  it("[sc-validation] unknown keys and empty bodies are rejected", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    expect((await patch(sup.token, {})).status).toBe(400);
    expect((await patch(sup.token, { maintenance: { enabled: true, evil: 1 }, reason: "testing" })).status).toBe(400);
    expect((await patch(sup.token, { approval: { manualApproval: "yes" } })).status).toBe(400);
  });
});

describe("maintenance mode", () => {
  it("[mm-flow] needs a reason to switch on; members get 503 with the message; admin, status and webhook paths stay up; off restores at once; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const m = await buildReadyProfile("mm", refs);

    expect((await patch(sup.token, { maintenance: { enabled: true, message: "Back soon" } })).status).toBe(400); // no reason
    expect((await myProfile(req(`${URL_}/profiles/me`, undefined, { token: m.member.sessionToken, method: "GET" }))).status).toBe(200);

    expect((await patch(sup.token, { maintenance: { enabled: true, message: "Back at 6pm" }, reason: "Database upgrade" })).status).toBe(200);
    const blocked = await myProfile(req(`${URL_}/profiles/me`, undefined, { token: m.member.sessionToken, method: "GET" }));
    expect(blocked.status).toBe(503);
    const body = await blocked.json();
    expect(body.error.message).toBe("Back at 6pm");
    expect(body.error.details).toEqual({ maintenance: true });
    expect((await search()).status).toBe(503); // anonymous visitors too

    // exempt
    expect((await adminMe(jreq(`${URL_}/admin/me`, { token: sup.token }))).status).toBe(200);
    expect((await read(sup.token)).status).toBe(200);
    const st = await (await siteStatus(jreq(`${URL_}/site-status`))).json();
    expect(st.data.maintenance).toBe(true);
    expect(st.data.message).toBe("Back at 6pm");
    expect(isMaintenanceExempt("/api/v1/webhooks/razorpay")).toBe(true);
    expect(isMaintenanceExempt("/api/v1/internal/jobs/run")).toBe(true);
    expect(isMaintenanceExempt("/api/v1/health/ready")).toBe(true);
    expect(isMaintenanceExempt("/api/v1/administrator")).toBe(false);
    expect(isMaintenanceExempt("/api/v1/profiles/me")).toBe(false);

    expect((await patch(sup.token, { maintenance: { enabled: false } })).status).toBe(200); // off needs no reason
    expect((await myProfile(req(`${URL_}/profiles/me`, undefined, { token: m.member.sessionToken, method: "GET" }))).status).toBe(200);
    expect((await (await (await siteStatus(jreq(`${URL_}/site-status`))).json()).data.maintenance)).toBe(false);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "settings.maintenance_changed"));
    expect(logs.length).toBe(2);
    expect(JSON.stringify(logs[0].metadata)).toContain("Database upgrade");
  });
});

describe("manual profile approval", () => {
  it("[ma-flow] with the switch on a newly-ready profile is hidden until approved; reject needs a reason; edit resubmits; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const viewer = await buildReadyProfile("ma-viewer", refs, { gender: "MALE" }); // built while OFF → auto-approved
    const old = await buildReadyProfile("ma-old", refs, { gender: "FEMALE" });
    expect((await patch(sup.token, { approval: { manualApproval: true } })).status).toBe(200);

    const fresh = await buildReadyProfile("ma-fresh", refs, { gender: "FEMALE" });
    const rows = await db.select().from(profiles);
    expect(rows.find((r) => r.id === old.profileId)!.approvalStatus).toBe("APPROVED"); // grandfathered
    expect(rows.find((r) => r.id === fresh.profileId)!.approvalStatus).toBe("PENDING");

    // invisible to other members and visitors; owner still sees it, with the status
    const s1 = await (await search(viewer.member.sessionToken)).json();
    expect(s1.data.items.length).toBe(1);
    expect((await view(fresh.profileId, viewer.member.sessionToken)).status).toBe(404);
    expect((await view(fresh.profileId)).status).toBe(404);
    expect((await view(old.profileId, viewer.member.sessionToken)).status).toBe(200);
    const mine = await (await myProfile(req(`${URL_}/profiles/me`, undefined, { token: fresh.member.sessionToken, method: "GET" }))).json();
    expect(mine.data.profile.approvalStatus).toBe("PENDING");

    // queue
    const q = await (await queue(sup.token)).json();
    expect(q.data.total).toBe(1);
    expect(q.data.items[0].profileId).toBe(fresh.profileId);

    // reject: reason required
    expect((await decideOn(sup.token, fresh.profileId, { decision: "REJECT" })).status).toBe(400);
    expect((await decideOn(sup.token, fresh.profileId, { decision: "REJECT", reason: "Photo is not of you" })).status).toBe(200);
    expect((await decideOn(sup.token, fresh.profileId, { decision: "REJECT", reason: "Photo is not of you" })).status).toBe(409); // already rejected
    expect((await view(fresh.profileId, viewer.member.sessionToken)).status).toBe(404);
    const rejected = await (await myProfile(req(`${URL_}/profiles/me`, undefined, { token: fresh.member.sessionToken, method: "GET" }))).json();
    expect(rejected.data.profile.approvalStatus).toBe("REJECTED");
    expect(rejected.data.profile.approvalReason).toBe("Photo is not of you");

    // owner edits → back to the queue
    const edit = await patchMyProfile(req(`${URL_}/profiles/me`, { aboutMe: "Updated about me text." }, { token: fresh.member.sessionToken, method: "PATCH" }));
    expect(edit.status).toBe(200);
    expect((await db.select().from(profiles).where(eq(profiles.id, fresh.profileId)))[0].approvalStatus).toBe("PENDING");

    // approve → visible everywhere
    expect((await decideOn(sup.token, fresh.profileId, { decision: "APPROVE" })).status).toBe(200);
    expect((await view(fresh.profileId, viewer.member.sessionToken)).status).toBe(200);
    expect((await (await (await search(viewer.member.sessionToken)).json()).data.items.length)).toBe(2);
    expect((await decideOn(sup.token, fresh.profileId, { decision: "BOGUS" })).status).toBe(400);

    const logs = await db.select().from(auditLogs);
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("profile.rejected");
    expect(actions).toContain("profile.approved");
    expect(actions).toContain("settings.profile_approval_changed");
  });

  it("[ma-off-default] with the switch off a ready profile is approved automatically; switching on later does not hide it", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const viewer = await buildReadyProfile("ma2-viewer", refs, { gender: "MALE" });
    const a = await buildReadyProfile("ma2-a", refs, { gender: "FEMALE" });
    expect((await db.select().from(profiles).where(eq(profiles.id, a.profileId)))[0].approvalStatus).toBe("APPROVED");
    await patch(sup.token, { approval: { manualApproval: true } });
    // losing and re-adding nothing: simply editing keeps it visible
    await patchMyProfile(req(`${URL_}/profiles/me`, { aboutMe: "Another honest sentence." }, { token: a.member.sessionToken, method: "PATCH" }));
    expect((await view(a.profileId, viewer.member.sessionToken)).status).toBe(200);
  });

  it("[ma-authz] deciding needs profiles.approve: Super Admin yes, staff no until granted (and revocable)", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const refs = await resolveReferenceIds();
    await patch(sup.token, { approval: { manualApproval: true } });
    const fresh = await buildReadyProfile("ma3", refs, { gender: "FEMALE" });
    expect((await queue(undefined)).status).toBe(401);
    expect((await queue(fresh.member.sessionToken)).status).toBeGreaterThanOrEqual(401);
    expect((await queue(staff.token)).status).toBe(403);
    expect((await decideOn(staff.token, fresh.profileId, { decision: "APPROVE" })).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "profiles.approve");
    expect((await queue(staff.token)).status).toBe(200);
    expect((await decideOn(staff.token, fresh.profileId, { decision: "APPROVE" })).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "profiles.approve");
    expect((await queue(staff.token)).status).toBe(403);
    expect((await decideOn(sup.token, "not-a-uuid", { decision: "APPROVE" })).status).toBe(404);
  });
});
