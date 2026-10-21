/**
 * Profile photo uploads are stored and served as WebP (POST /profiles/me/photos is the only upload route).
 * Covers the route end to end: conversion and the served file, every rejection path leaving nothing behind,
 * cleanup of the stored file when the database insert fails, and photos stored before WebP still being served.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { POST as createProfile } from "@/app/api/v1/profiles/me/route";
import { GET as listPhotos, POST as uploadPhoto } from "@/app/api/v1/profiles/me/photos/route";
import { GET as getPhotoFile } from "@/app/api/v1/profiles/photos/[photoId]/file/route";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import { getStorageProvider } from "@/server/modules/storage/factory";
import { LocalDiskStorageProvider } from "@/server/modules/storage/local-disk.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember, tinyPngBuffer, makePhotoFormData } from "./helpers/profile-fixtures";

// Lets one test make the photo-row insert fail after the file has been stored.
const failNextInsert = vi.hoisted(() => ({ value: false }));
vi.mock("@/server/modules/profiles/profiles.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/profiles/profiles.repository")>();
  return {
    ...actual,
    createPhoto: async (...args: Parameters<typeof actual.createPhoto>) => {
      if (failNextInsert.value) {
        failNextInsert.value = false;
        throw new Error("simulated database failure");
      }
      return actual.createPhoto(...args);
    },
  };
});

function uploadReq(token: string, buffer: Buffer, filename = "photo.jpg", type = "image/jpeg") {
  return new NextRequest("http://localhost/api/v1/profiles/me/photos", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: makePhotoFormData(buffer, filename, type),
  });
}
const fileReq = (photoId: string, token: string) =>
  getPhotoFile(new NextRequest(`http://localhost/api/v1/profiles/photos/${photoId}/file`, { headers: { authorization: `Bearer ${token}` } }), {
    params: { photoId },
  });
const photoCount = async (token: string) =>
  (await (await listPhotos(new NextRequest("http://localhost/api/v1/profiles/me/photos", { headers: { authorization: `Bearer ${token}` } }))).json()).data.photos.length;

async function memberWithProfile() {
  const member = await createVerifiedMember("webp-photo");
  await createProfile(req("http://localhost/api/v1/profiles/me", { gender: "FEMALE", dateOfBirth: "1994-04-04" }, { token: member.sessionToken }));
  const profile = await profilesRepo.findByUserId(member.userId);
  return { member, profileId: profile!.id };
}

describe("Profile photo uploads are converted to WebP", () => {
  let uploads: string[];

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
    failNextInsert.value = false;
    uploads = [];
    const realUpload = LocalDiskStorageProvider.prototype.upload;
    vi.spyOn(LocalDiskStorageProvider.prototype, "upload").mockImplementation(function (this: LocalDiskStorageProvider, input) {
      uploads.push(input.key);
      return realUpload.call(this, input);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("[webp-upload] a JPEG with EXIF is stored, listed and served as an oriented WebP without its metadata", async () => {
    const { member, profileId } = await memberWithProfile();
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 80 } } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "gps-and-owner-details" } } })
      .toBuffer();

    const res = await uploadPhoto(uploadReq(member.sessionToken, jpeg, "holiday.JPG"));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.photo).toMatchObject({ mimeType: "image/webp", width: 600, height: 800, isPrimary: true, url: `/api/v1/profiles/photos/${data.photo.id}/file` });
    expect(uploads).toEqual([`photos/${profileId}/${data.photo.id}.webp`]);

    const file = await fileReq(data.photo.id, member.sessionToken);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    const served = Buffer.from(await file.arrayBuffer());
    expect(served.toString("ascii", 0, 4)).toBe("RIFF");
    expect(served.toString("ascii", 8, 12)).toBe("WEBP");
    expect(served.includes(Buffer.from("gps-and-owner-details"))).toBe(false);
    const meta = await sharp(served).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["webp", 600, 800, undefined]);
  });

  it("[webp-rejections] corrupt, fake, SVG, oversized, too-small and pixel-bomb uploads get 400 and store nothing", async () => {
    const { member } = await memberWithProfile();
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#884422" } }).jpeg().toBuffer();
    const bomb = tinyPngBuffer(1, 1);
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);
    const cases: Array<[string, Buffer, string, string, RegExp]> = [
      ["truncated JPEG", jpeg.subarray(0, 400), "a.jpg", "image/jpeg", /couldn't read this image|invalid image/i],
      ["text named .png", Buffer.from("definitely not an image"), "a.png", "image/png", /Unsupported or invalid image/],
      ["SVG with script", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "a.svg", "image/svg+xml", /Unsupported or invalid image/],
      ["over 5MB", Buffer.concat([tinyPngBuffer(300, 300), Buffer.alloc(5 * 1024 * 1024)]), "big.png", "image/png", /maximum allowed size/],
      ["below 200px", tinyPngBuffer(150, 150), "small.png", "image/png", /at least 200x200/],
      ["pixel bomb header", bomb, "bomb.png", "image/png", /couldn't read this image|too many pixels/i],
    ];
    for (const [name, buffer, filename, type, message] of cases) {
      const res = await uploadPhoto(uploadReq(member.sessionToken, buffer, filename, type));
      expect(res.status, name).toBe(400);
      const body = await res.json();
      expect(body.error.code, name).toBe("VALIDATION_ERROR");
      expect(body.error.message, name).toMatch(message);
    }
    expect(uploads).toEqual([]);
    expect(await photoCount(member.sessionToken)).toBe(0);
  });

  it("[webp-db-failure] if saving the photo row fails, the stored WebP is deleted and no photo is listed", async () => {
    const { member } = await memberWithProfile();
    failNextInsert.value = true;
    const res = await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300), "a.png", "image/png"));
    expect(res.status).toBe(500);
    expect(uploads).toHaveLength(1);
    expect(await getStorageProvider().read(uploads[0])).toBeNull();
    expect(await photoCount(member.sessionToken)).toBe(0);
    // and the next upload works normally
    expect((await uploadPhoto(uploadReq(member.sessionToken, tinyPngBuffer(300, 300), "a.png", "image/png"))).status).toBe(201);
  });

  it("[webp-legacy] a PNG photo stored before WebP conversion is still served unchanged", async () => {
    const { member, profileId } = await memberWithProfile();
    const png = tinyPngBuffer(320, 320);
    const id = randomUUID();
    const storageKey = `photos/${profileId}/${id}.png`;
    await getStorageProvider().upload({ key: storageKey, buffer: png, contentType: "image/png" });
    await profilesRepo.createPhoto({
      id,
      profileId,
      url: `/api/v1/profiles/photos/${id}/file`,
      storageKey,
      originalFilename: "old.png",
      mimeType: "image/png",
      fileSizeBytes: png.length,
      width: 320,
      height: 320,
      uploadStatus: "COMPLETE",
      isPrimary: true,
      sortOrder: 0,
    });
    const file = await fileReq(id, member.sessionToken);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), png)).toBe(0);
  });
});
