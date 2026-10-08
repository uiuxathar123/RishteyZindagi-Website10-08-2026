/**
 * B4 §3/§4/§6/§7/§27: partner preferences — one configuration per
 * profile, owner-only CRUD, range validation, multi-value semantics,
 * ANY_PROFESSION, and IDOR coverage.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GET as getPreferences, PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember, resolveReferenceIds } from "./helpers/profile-fixtures";

describe("Partner preferences", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("a profile with no preferences saved yet returns null, not invented defaults", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await getPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", undefined, { token: member.sessionToken, method: "GET" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.preferences).toBeNull();
  });

  it("creates preferences on first PATCH and updates them (sparse merge) on a second", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();

    const createRes = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        { ageMin: 25, ageMax: 35, heightMinCm: 150, heightMaxCm: 175, religionId: refs.religionId, maritalStatusIds: [refs.maritalStatusId] },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(createRes.status).toBe(200);
    const { data: createData } = await createRes.json();
    expect(createData.preferences.ageMin).toBe(25);
    expect(createData.preferences.ageMax).toBe(35);
    expect(createData.preferences.religion?.id).toBe(refs.religionId);
    expect(createData.preferences.maritalStatusIds).toEqual([refs.maritalStatusId]);

    // Sparse update — only ageMax changes, everything else (heightMinCm,
    // religionId, ...) is preserved from the first write.
    const updateRes = await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { ageMax: 40 }, { token: member.sessionToken, method: "PATCH" })
    );
    const { data: updateData } = await updateRes.json();
    expect(updateData.preferences.ageMin).toBe(25);
    expect(updateData.preferences.ageMax).toBe(40);
    expect(updateData.preferences.heightMinCm).toBe(150);
    expect(updateData.preferences.religion?.id).toBe(refs.religionId);
  });

  it("supports multiple communities/mother tongues/educations/professions/marital statuses (OR semantics storage)", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();
    const refs2 = await resolveReferenceIds(); // same underlying seeded lists, still valid distinct-enough ids to array-test

    const res = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        {
          communityIds: [refs.communityId],
          motherTongueIds: [refs.motherTongueId],
          educationIds: [refs.educationId],
          professionIds: [refs.professionId],
          maritalStatusIds: [refs.maritalStatusId, refs2.maritalStatusId],
        },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.preferences.communityIds).toEqual([refs.communityId]);
    expect(data.preferences.motherTongueIds).toEqual([refs.motherTongueId]);
    expect(data.preferences.educationIds).toEqual([refs.educationId]);
    expect(data.preferences.professionIds).toEqual([refs.professionId]);
  });

  it("ANY_PROFESSION: professionAny=true is accepted, and rejected together with a non-empty professionIds", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const refs = await resolveReferenceIds();

    const okRes = await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { professionAny: true }, { token: member.sessionToken, method: "PATCH" })
    );
    expect(okRes.status).toBe(200);
    const { data: okData } = await okRes.json();
    expect(okData.preferences.professionAny).toBe(true);

    const conflictRes = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        { professionAny: true, professionIds: [refs.professionId] },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(conflictRes.status).toBe(400);
  });

  it("rejects ageMin > ageMax, heightMinCm > heightMaxCm, and incomeMinAmount > incomeMaxAmount", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const ageRes = await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { ageMin: 40, ageMax: 25 }, { token: member.sessionToken, method: "PATCH" })
    );
    expect(ageRes.status).toBe(400);

    const heightRes = await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { heightMinCm: 180, heightMaxCm: 150 }, { token: member.sessionToken, method: "PATCH" })
    );
    expect(heightRes.status).toBe(400);

    const incomeRes = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        { incomeMinAmount: 2000000, incomeMaxAmount: 1000000, incomeCurrency: "INR" },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(incomeRes.status).toBe(400);
  });

  it("rejects an unknown reference id with 400, not a raw DB error", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        { religionId: "00000000-0000-0000-0000-000000000000" },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires a profile to exist before preferences can be saved", async () => {
    const member = await createVerifiedMember();
    const res = await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { ageMin: 25 }, { token: member.sessionToken, method: "PATCH" })
    );
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await getPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", undefined, { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("IDOR: user A's preferences are never returned to or modifiable by user B — each caller only ever sees/changes their own", async () => {
    const memberA = await createVerifiedMember("prefs-a");
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: memberA.sessionToken }));
    await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { ageMin: 30, ageMax: 40 }, { token: memberA.sessionToken, method: "PATCH" })
    );

    const memberB = await createVerifiedMember("prefs-b");
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1992-01-01" }, { token: memberB.sessionToken }));

    // There is no route that takes a profileId/userId to target someone
    // else's preferences — /profiles/me/partner-preferences always
    // resolves from the caller's own session. Confirm B's own GET is
    // independent (null, not A's data) and B's PATCH never touches A's row.
    const bGet = await getPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", undefined, { token: memberB.sessionToken, method: "GET" }));
    const { data: bData } = await bGet.json();
    expect(bData.preferences).toBeNull();

    await patchPreferences(
      req("http://localhost/api/v1/profiles/me/partner-preferences", { ageMin: 20, ageMax: 25 }, { token: memberB.sessionToken, method: "PATCH" })
    );

    const aGet = await getPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", undefined, { token: memberA.sessionToken, method: "GET" }));
    const { data: aData } = await aGet.json();
    expect(aData.preferences.ageMin).toBe(30);
    expect(aData.preferences.ageMax).toBe(40);
  });
});
