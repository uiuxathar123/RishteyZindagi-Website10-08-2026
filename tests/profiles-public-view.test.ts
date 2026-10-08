/**
 * B3 §9/§10/§11/§16: the three-audience data boundary (owner /
 * authenticated / anonymous) for GET /profiles/:profileId, visibility
 * gating on profile readiness, and the gated photo-file delivery route.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { PATCH as updateProfile } from "@/app/api/v1/profiles/me/route";
import { POST as uploadPhoto } from "@/app/api/v1/profiles/me/photos/route";
import { GET as getPublicProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { GET as getPhotoFile } from "@/app/api/v1/profiles/photos/[photoId]/file/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import {
  req,
  createVerifiedMember,
  resolveReferenceIds,
  fullProfilePatchBody,
  tinyPngBuffer,
  makePhotoFormData,
  type TestMember,
} from "./helpers/profile-fixtures";

function uploadReq(token: string, buffer: Buffer) {
  return new NextRequest("http://localhost/api/v1/profiles/me/photos", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: makePhotoFormData(buffer),
  });
}

interface ReadyProfile {
  member: TestMember;
  profileId: string;
  photoId: string;
}

async function buildReadyProfile(namePrefix: string): Promise<ReadyProfile> {
  const member = await createVerifiedMember(namePrefix);
  const createRes = await createProfile(
    req("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1994-03-10" }, { token: member.sessionToken })
  );
  const { data: createData } = await createRes.json();
  const refs = await resolveReferenceIds();
  await updateProfile(req("http://localhost/api/v1/profiles/me", fullProfilePatchBody(refs), { token: member.sessionToken, method: "PATCH" }));
  const photoRes = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
  const { data: photoData } = await photoRes.json();
  return { member, profileId: createData.profile.id as string, photoId: photoData.photo.id as string };
}

function getReq(url: string, token?: string) {
  return new NextRequest(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
}

const profileCtx = (profileId: string) => ({ params: { profileId } });
const photoCtx = (photoId: string) => ({ params: { photoId } });

describe("Public / gated profile view", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("a not-yet-ready profile is 404 to anyone but its owner", async () => {
    const member = await createVerifiedMember();
    const createRes = await createProfile(
      req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken })
    );
    const { data: createData } = await createRes.json();
    const other = await createVerifiedMember("viewer");
    const profileId = createData.profile.id as string;

    const anonRes = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`), profileCtx(profileId));
    expect(anonRes.status).toBe(404);

    const otherRes = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`, other.sessionToken), profileCtx(profileId));
    expect(otherRes.status).toBe(404);

    const ownerRes = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`, member.sessionToken), profileCtx(profileId));
    expect(ownerRes.status).toBe(200);
    const { data: ownerData } = await ownerRes.json();
    expect(ownerData.audience).toBe("owner");
  });

  it("owner view includes full detail; authenticated non-owner view excludes email/mobile and account info", async () => {
    const { member, profileId } = await buildReadyProfile("ready-owner");
    const viewer = await createVerifiedMember("ready-viewer");

    const ownerRes = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`, member.sessionToken), profileCtx(profileId));
    const { data: ownerData } = await ownerRes.json();
    expect(ownerData.audience).toBe("owner");
    expect(ownerData.profile.religion?.name).toBeTruthy();
    expect(ownerData.profile.photos).toHaveLength(1);

    const viewerRes = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`, viewer.sessionToken), profileCtx(profileId));
    expect(viewerRes.status).toBe(200);
    const { data: viewerData } = await viewerRes.json();
    expect(viewerData.audience).toBe("authenticated");
    expect(viewerData.profile.displayName).toBe("Profile Test User");
    expect(viewerData.profile.religion).toBeTruthy();
    expect(viewerData.profile.photos[0].url).toMatch(/^\/api\/v1\/profiles\/photos\/.+\/file$/);
    expect(JSON.stringify(viewerData.profile)).not.toMatch(/@example\.com/);
    expect(viewerData.profile.mobileNumber).toBeUndefined();
    expect(viewerData.profile.email).toBeUndefined();
  });

  it("anonymous visitor gets the gated view: generic display name, no email/mobile, no photo URL", async () => {
    const { profileId } = await buildReadyProfile("anon-target");

    const res = await getPublicProfile(getReq(`http://localhost/api/v1/profiles/${profileId}`), profileCtx(profileId));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.audience).toBe("anonymous");
    expect(data.profile.displayName).toBe("Member Profile");
    expect(data.profile.photoBlurred).toBe(true);
    expect(data.profile.country).toBe("India");
    expect(data.profile.education).toBeTruthy();
    // Never leaked to anonymous:
    expect(JSON.stringify(data.profile)).not.toMatch(/@example\.com/);
    expect(data.profile.religion).toBeUndefined();
    expect(data.profile.photos).toBeUndefined();
    expect(data.profile.aboutMe).toBeUndefined();
  });

  it("gated photo file route: anonymous access is always rejected with 401", async () => {
    const { photoId } = await buildReadyProfile("photo-file");

    const anonRes = await getPhotoFile(getReq(`http://localhost/api/v1/profiles/photos/${photoId}/file`), photoCtx(photoId));
    expect(anonRes.status).toBe(401);
  });

  it("gated photo file route: another authenticated user CAN fetch a photo once the profile is READY_FOR_VISIBILITY", async () => {
    const { photoId } = await buildReadyProfile("photo-file-ready");
    const viewer = await createVerifiedMember("photo-file-viewer");

    const res = await getPhotoFile(getReq(`http://localhost/api/v1/profiles/photos/${photoId}/file`, viewer.sessionToken), photoCtx(photoId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("gated photo file route: another authenticated user CANNOT fetch a photo while the profile is not ready", async () => {
    const member = await createVerifiedMember("photo-file-notready");
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const photoRes = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
    const { data: photoData } = await photoRes.json();

    const viewer = await createVerifiedMember("photo-file-notready-viewer");
    const res = await getPhotoFile(
      getReq(`http://localhost/api/v1/profiles/photos/${photoData.photo.id}/file`, viewer.sessionToken),
      photoCtx(photoData.photo.id)
    );
    expect(res.status).toBe(404);
  });
});
