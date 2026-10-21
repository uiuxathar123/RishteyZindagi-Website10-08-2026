/**
 * "Company Verified": a separate profile review decided only by a Super Admin.
 *  - NONE -> PENDING -> APPROVED | REJECTED; APPROVED -> REVOKED; approving needs an open review first;
 *  - only APPROVED exposes `companyVerified: true` in the member and anonymous profile views (a boolean only — never
 *    the reviewer or the notes); the staff verification status is untouched;
 *  - status, reviewer and date are kept on the profile and every change is in the audit history;
 *  - a Staff Admin holding "profiles.verify" (the staff verification permission) is still refused.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, profiles } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { GET as viewProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { buildReadyProfile, req, resolveReferenceIds, type ReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, type TestAdmin } from "./helpers/pcp";
import { api, json } from "./helpers/matchmaking";

const U = "http://localhost/api/v1";
let refs: ReferenceIds;
let admin: TestAdmin;
let subject: ReadyProfile;
let viewer: ReadyProfile;

const view = async (p: ReadyProfile, token?: string) =>
  json(await viewProfile(req(`${U}/profiles/${p.profileId}`, undefined, { token, method: "GET" }), { params: { profileId: p.profileId } }));
const decide = async (status: string, note?: string, token = admin.token) =>
  json(await api.admin.decideCompanyVerification(token, subject.member.userId, { status, ...(note ? { note } : {}) }));
const row = async () => (await db.select().from(profiles).where(eq(profiles.userId, subject.member.userId)))[0];

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  admin = await createAdmin("SUPER_ADMIN");
  subject = await buildReadyProfile("cv-subject", refs, { gender: "FEMALE", dateOfBirth: "1995-06-06" });
  __resetRateLimitsForTests();
  viewer = await buildReadyProfile("cv-viewer", refs, { gender: "MALE", dateOfBirth: "1992-04-04" });
}, 120_000);

describe("Company Verified", () => {
  it("[cv-review-flow] approve needs an open review; approval shows the badge flag; revoke removes it; reviewer, date and history are kept", async () => {
    expect((await view(subject, viewer.member.sessionToken)).body.data.profile.companyVerified).toBe(false);
    const staffStatusBefore = (await row()).verificationStatus;

    expect((await decide("APPROVED")).status).toBe(409); // no review open yet
    expect((await decide("PENDING", "documents requested")).status).toBe(200);
    expect((await view(subject, viewer.member.sessionToken)).body.data.profile.companyVerified).toBe(false); // pending is not verified

    const approved = await decide("APPROVED", "documents checked");
    expect(approved.status).toBe(200);
    expect(approved.body.data.verification).toMatchObject({ status: "APPROVED", reviewedBy: { id: admin.id } });
    const r = await row();
    expect(r).toMatchObject({ companyVerificationStatus: "APPROVED", companyVerificationReviewedByAdminId: admin.id });
    expect(r.companyVerificationReviewedAt).toBeInstanceOf(Date);
    expect(r.verificationStatus).toBe(staffStatusBefore); // staff verification untouched

    const member = (await view(subject, viewer.member.sessionToken)).body.data.profile;
    expect(member.companyVerified).toBe(true);
    expect(JSON.stringify(member)).not.toContain("documents checked");
    expect(JSON.stringify(member)).not.toContain(admin.id);
    expect((await view(subject)).body.data.profile.companyVerified).toBe(true); // anonymous card too

    expect((await decide("APPROVED")).status).toBe(409);
    expect((await decide("REVOKED", "complaint received")).status).toBe(200);
    expect((await view(subject, viewer.member.sessionToken)).body.data.profile.companyVerified).toBe(false);

    const history = (await json(await api.admin.getCompanyVerification(admin.token, subject.member.userId))).body.data.verification.history;
    expect(history.map((h: { from: string; to: string }) => `${h.from}->${h.to}`)).toEqual(["APPROVED->REVOKED", "PENDING->APPROVED", "NONE->PENDING"]);
    expect(history[1]).toMatchObject({ note: "documents checked", reviewer: { id: admin.id } });
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "profile.company_verification_changed"), eq(auditLogs.entityId, r.id)));
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a.actorType === "ADMIN" && a.actorId === admin.id)).toBe(true);
  });

  it("[cv-reject-reopen] a rejected review can be reopened and then approved", async () => {
    expect((await decide("PENDING")).status).toBe(200);
    expect((await decide("REJECTED", "photo mismatch")).status).toBe(200);
    expect((await decide("APPROVED")).status).toBe(409);
    expect((await decide("PENDING")).status).toBe(200);
    expect((await decide("APPROVED")).status).toBe(200);
    expect((await row()).companyVerificationStatus).toBe("APPROVED");
  });

  it("[cv-concurrent] two simultaneous approvals: exactly one applies", async () => {
    expect((await decide("PENDING")).status).toBe(200);
    const codes = (await Promise.all([decide("APPROVED"), decide("APPROVED"), decide("REJECTED")])).map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
  });

  it("[cv-authz] only a Super Admin: staff with profiles.verify, members and anonymous callers are refused", async () => {
    const staff = await createAdmin("STAFF_ADMIN"); // the seeded staff role holds "profiles.verify"
    expect((await decide("PENDING", undefined, staff.token)).status).toBe(403);
    expect((await api.admin.getCompanyVerification(staff.token, subject.member.userId)).status).toBe(403);
    expect((await decide("PENDING", undefined, viewer.member.sessionToken)).status).toBe(403);
    expect((await decide("PENDING", undefined, "")).status).toBe(401);
    expect((await row()).companyVerificationStatus).toBe("NONE");
  });
});
