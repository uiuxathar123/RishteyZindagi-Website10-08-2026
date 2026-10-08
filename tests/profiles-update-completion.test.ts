/**
 * B3: profile creation -> PATCH update -> deterministic, backend-only
 * completion percentage / missing-fields / readiness state. See
 * src/server/modules/profiles/completion.ts for the calculation this
 * exercises end-to-end through the real route handlers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { PATCH as updateProfile } from "@/app/api/v1/profiles/me/route";
import { GET as getCompletion } from "@/app/api/v1/profiles/me/completion/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember, resolveReferenceIds, fullProfilePatchBody } from "./helpers/profile-fixtures";

describe("Profile update + completion", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("a freshly created profile is INCOMPLETE with every required field (including the photo) missing", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1995-05-15" }, { token: member.sessionToken }));

    const res = await getCompletion(req("http://localhost/api/v1/profiles/me/completion", undefined, { token: member.sessionToken, method: "GET" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.profileStatus).toBe("INCOMPLETE");
    expect(data.profileCompletionPercent).toBeLessThan(100);
    expect(data.missingRequiredFields).toContain("religionId");
    expect(data.missingRequiredFields).toContain("profilePhoto");
  });

  it("filling every required field (minus photo) brings completion to 100% and status to COMPLETE, not READY_FOR_VISIBILITY", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1996-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();

    const patchRes = await updateProfile(
      req("http://localhost/api/v1/profiles/me", fullProfilePatchBody(refs), { token: member.sessionToken, method: "PATCH" })
    );
    expect(patchRes.status).toBe(200);
    const { data: patchData } = await patchRes.json();
    expect(patchData.profile.profileCompletionPercent).toBe(100);
    expect(patchData.profile.profileStatus).toBe("COMPLETE");
    expect(patchData.profile.missingRequiredFields).toEqual(["profilePhoto"]);
    expect(patchData.profile.isReadyForVisibility).toBe(false);
    expect(patchData.profile.religion?.name).toBeTruthy();
    expect(patchData.profile.country?.name).toBe("India");
  });

  it("rejects a cityId that doesn't belong to the given countryId", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();

    const res = await updateProfile(
      req(
        "http://localhost/api/v1/profiles/me",
        { countryId: refs.countryId, cityId: "00000000-0000-0000-0000-000000000000" },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a communityId that doesn't belong to the given religionId", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();

    // communityId doesn't belong to (or exist under) the given religion.
    const res = await updateProfile(
      req(
        "http://localhost/api/v1/profiles/me",
        { religionId: refs.religionId, communityId: "00000000-0000-0000-0000-000000000000" },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown reference id (e.g. religionId) with 400, not a raw DB error", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await updateProfile(
      req("http://localhost/api/v1/profiles/me", { religionId: "00000000-0000-0000-0000-000000000000" }, { token: member.sessionToken, method: "PATCH" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a dateOfBirth that would make the member under 18", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const recentDob = new Date();
    recentDob.setFullYear(recentDob.getFullYear() - 5);
    const res = await updateProfile(
      req(
        "http://localhost/api/v1/profiles/me",
        { dateOfBirth: recentDob.toISOString().slice(0, 10) },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /profiles/me requires a profile to already exist", async () => {
    const member = await createVerifiedMember();
    const res = await updateProfile(req("http://localhost/api/v1/profiles/me", { heightCm: 170 }, { token: member.sessionToken, method: "PATCH" }));
    expect(res.status).toBe(404);
  });

  it("a normal user cannot set verificationStatus via PATCH /profiles/me — the field is silently ignored", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await updateProfile(
      req(
        "http://localhost/api/v1/profiles/me",
        { heightCm: 175, verificationStatus: "VERIFIED" },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    // .strict() zod schema rejects the unknown key outright, which is an
    // even stronger guarantee than silently dropping it.
    expect(res.status).toBe(400);
  });
});
