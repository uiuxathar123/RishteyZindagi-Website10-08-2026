/**
 * B3: profile photo upload/list/primary/reorder/delete, the primary-photo
 * invariants (§13), last-photo-deletion behavior, content-type/dimension
 * validation, and cross-user IDOR protection (§21).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { GET as getCompletion } from "@/app/api/v1/profiles/me/completion/route";
import { GET as listPhotos, POST as uploadPhoto } from "@/app/api/v1/profiles/me/photos/route";
import { PATCH as reorderPhotos } from "@/app/api/v1/profiles/me/photos/reorder/route";
import { PATCH as setPrimaryPhoto } from "@/app/api/v1/profiles/me/photos/[photoId]/primary/route";
import { DELETE as deletePhoto } from "@/app/api/v1/profiles/me/photos/[photoId]/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember, tinyPngBuffer, makePhotoFormData } from "./helpers/profile-fixtures";

function uploadReq(token: string, buffer: Buffer, filename = "photo.png", type = "image/png") {
  return new NextRequest("http://localhost/api/v1/profiles/me/photos", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: makePhotoFormData(buffer, filename, type),
  });
}

function ctx(photoId: string) {
  return { params: { photoId } };
}

describe("Profile photos", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("uploads a photo, making it primary at sortOrder 0", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.photo.isPrimary).toBe(true);
    expect(data.photo.sortOrder).toBe(0);
    expect(data.photo.mimeType).toBe("image/webp"); // uploads are re-encoded as WebP
    expect(data.photo.width).toBe(300);
    expect(data.photo.url).toBe(`/api/v1/profiles/photos/${data.photo.id}/file`);
  });

  it("a second upload is not primary, and completion's photo gate flips once any photo exists", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const before = await getCompletion(req("http://localhost/api/v1/profiles/me/completion", undefined, { token: member.sessionToken }));
    const { data: beforeData } = await before.json();
    expect(beforeData.missingRequiredFields).toContain("profilePhoto");

    await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
    const secondRes = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
    const { data: secondData } = await secondRes.json();
    expect(secondData.photo.isPrimary).toBe(false);
    expect(secondData.photo.sortOrder).toBe(1);

    const after = await getCompletion(req("http://localhost/api/v1/profiles/me/completion", undefined, { token: member.sessionToken }));
    const { data: afterData } = await after.json();
    expect(afterData.missingRequiredFields).not.toContain("profilePhoto");
  });

  it("rejects a file that isn't a real image (bad magic bytes) with 400", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await uploadPhoto(uploadReq(member.sessionToken, Buffer.from("not-an-image-at-all"), "photo.png"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an image below the minimum dimensions with 400", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const res = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(50, 50)));
    expect(res.status).toBe(400);
  });

  it("setting a different photo primary demotes the previous primary — exactly one primary at all times", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    const p1 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();
    const p2 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();

    const res = await setPrimaryPhoto(
      req(`http://localhost/api/v1/profiles/me/photos/${p2.data.photo.id}/primary`, {}, { token: member.sessionToken, method: "PATCH" }),
      ctx(p2.data.photo.id)
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const byId = Object.fromEntries(data.photos.map((p: { id: string; isPrimary: boolean }) => [p.id, p.isPrimary]));
    expect(byId[p2.data.photo.id]).toBe(true);
    expect(byId[p1.data.photo.id]).toBe(false);
    expect(data.photos.filter((p: { isPrimary: boolean }) => p.isPrimary)).toHaveLength(1);
  });

  it("reorders photos and rejects a reorder that doesn't include exactly the existing set", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const p1 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();
    const p2 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();

    const goodRes = await reorderPhotos(
      req(
        "http://localhost/api/v1/profiles/me/photos/reorder",
        { photoIds: [p2.data.photo.id, p1.data.photo.id] },
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(goodRes.status).toBe(200);
    const { data: goodData } = await goodRes.json();
    expect(goodData.photos[0].id).toBe(p2.data.photo.id);
    expect(goodData.photos[1].id).toBe(p1.data.photo.id);

    const badRes = await reorderPhotos(
      req(
        "http://localhost/api/v1/profiles/me/photos/reorder",
        { photoIds: [p1.data.photo.id] }, // missing p2
        { token: member.sessionToken, method: "PATCH" }
      )
    );
    expect(badRes.status).toBe(400);
  });

  it("deleting the primary photo promotes another; deleting the last photo makes the profile INCOMPLETE again", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));
    const p1 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();
    const p2 = await (await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)))).json();
    expect(p1.data.photo.isPrimary).toBe(true);

    const del1 = await deletePhoto(
      req(`http://localhost/api/v1/profiles/me/photos/${p1.data.photo.id}`, undefined, { token: member.sessionToken, method: "DELETE" }),
      ctx(p1.data.photo.id)
    );
    expect(del1.status).toBe(200);
    const { data: del1Data } = await del1.json();
    expect(del1Data.newPrimaryPhotoId).toBe(p2.data.photo.id);

    const remaining = await listPhotos(req("http://localhost/api/v1/profiles/me/photos", undefined, { token: member.sessionToken }));
    const { data: remainingData } = await remaining.json();
    expect(remainingData.photos).toHaveLength(1);
    expect(remainingData.photos[0].isPrimary).toBe(true);

    const del2 = await deletePhoto(
      req(`http://localhost/api/v1/profiles/me/photos/${p2.data.photo.id}`, undefined, { token: member.sessionToken, method: "DELETE" }),
      ctx(p2.data.photo.id)
    );
    expect(del2.status).toBe(200);

    const completion = await getCompletion(req("http://localhost/api/v1/profiles/me/completion", undefined, { token: member.sessionToken }));
    const { data: completionData } = await completion.json();
    expect(completionData.profileStatus).toBe("INCOMPLETE");
    expect(completionData.missingRequiredFields).toContain("profilePhoto");
  });

  it("IDOR: user B cannot delete, set-primary, or reorder user A's photos", async () => {
    const userA = await createVerifiedMember("photo-owner");
    const userB = await createVerifiedMember("photo-attacker");
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: userA.sessionToken }));
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1992-01-01" }, { token: userB.sessionToken }));
    const aPhoto = await (await uploadPhoto(uploadReq(userA.sessionToken, tinyPngBuffer(300, 300)))).json();

    const deleteRes = await deletePhoto(
      req(`http://localhost/api/v1/profiles/me/photos/${aPhoto.data.photo.id}`, undefined, { token: userB.sessionToken, method: "DELETE" }),
      ctx(aPhoto.data.photo.id)
    );
    expect(deleteRes.status).toBe(403);

    const primaryRes = await setPrimaryPhoto(
      req(`http://localhost/api/v1/profiles/me/photos/${aPhoto.data.photo.id}/primary`, {}, { token: userB.sessionToken, method: "PATCH" }),
      ctx(aPhoto.data.photo.id)
    );
    expect(primaryRes.status).toBe(403);

    const reorderRes = await reorderPhotos(
      req(
        "http://localhost/api/v1/profiles/me/photos/reorder",
        { photoIds: [aPhoto.data.photo.id] },
        { token: userB.sessionToken, method: "PATCH" }
      )
    );
    expect(reorderRes.status).toBe(400); // not user B's photo set at all -> validation, not even ownership match
  });

  it("caps a profile at the maximum number of photos", async () => {
    const member = await createVerifiedMember();
    await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "MALE", dateOfBirth: "1990-01-01" }, { token: member.sessionToken }));

    for (let i = 0; i < 10; i++) {
      const res = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
      expect(res.status).toBe(201);
    }
    const overCap = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300)));
    expect(overCap.status).toBe(409);
  });
});
