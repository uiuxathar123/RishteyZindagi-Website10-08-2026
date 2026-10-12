/**
 * B3 test helper: registers+verifies+logs in a brand-new member (reusing
 * the B2 signup flow, same pattern every other test file uses) and looks
 * up real seeded reference-data ids so tests can build valid PATCH
 * payloads without hard-coding uuids. Requires `npm run db:seed` to have
 * been run against the test database at least once (same precondition
 * rbac.test.ts already has for admin_roles/permissions — see
 * BACKEND.md's B3 section).
 */
import { NextRequest } from "next/server";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { getDevOtpCode } from "@/server/modules/otp/providers/dev.provider";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";

export function req(url: string, body?: unknown, opts?: { token?: string; deviceId?: string; method?: string }) {
  return new NextRequest(url, {
    method: opts?.method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(opts?.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts?.deviceId ? { "x-device-id": opts.deviceId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export interface TestMember {
  userId: string;
  email: string;
  sessionToken: string;
  deviceId: string;
}

let counter = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function createVerifiedMember(namePrefix = "profile-test"): Promise<TestMember> {
  counter += 1;
  const email = `${namePrefix}-${counter}-${Date.now()}@example.com`;
  // 10 digits total ("9" + 9 more), with `counter` in the low-order
  // digits so it actually varies between calls — a previous version of
  // this sliced the varying digit off entirely, producing the same
  // mobile number for every member and a 409 on the second signup in
  // any test that creates two members.
  const mobileNumber = `9${String(counter).padStart(9, "0")}`;
  const deviceId = `${namePrefix}-device-${counter}`;

  const regRes = await register(req("http://localhost/api/v1/auth/register", { name: "Profile Test User", email, mobileNumber }));
  const payload: unknown = await regRes.json().catch(() => null);
  const body = isRecord(payload) ? payload : null;
  const data = isRecord(body?.data) ? body.data : null;
  const error = isRecord(body?.error) ? body.error : null;
  const errorCode =
    typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : null;
  if (regRes.status !== 201 || typeof data?.identifier !== "string" || data.identifier.length === 0) {
    throw new Error(
      `Registration fixture expected HTTP 201 with data.identifier; received HTTP ${regRes.status}${errorCode ? ` (${errorCode})` : ""}. Check the registration response and test configuration.`
    );
  }
  const identifier = data.identifier;
  const code = getDevOtpCode(identifier, "SIGNUP");
  if (!code) {
    throw new Error("Registration fixture received HTTP 201 but no local SIGNUP OTP was captured; check OTP test configuration.");
  }
  const verifyRes = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier, code }));
  const { data: verifyData } = await verifyRes.json();
  const setPwRes = await setPassword(
    req(
      "http://localhost/api/v1/auth/set-password",
      { identifier, ticket: verifyData.ticket, password: "correcthorsebattery" },
      { deviceId }
    )
  );
  const { data: setPwData } = await setPwRes.json();

  return { userId: setPwData.user.id, email, sessionToken: setPwData.sessionToken, deviceId };
}

export interface ReferenceIds {
  religionId: string;
  motherTongueId: string;
  educationId: string;
  professionId: string;
  maritalStatusId: string;
  countryId: string;
  cityId: string;
  communityId: string;
}

/** Resolves real seeded ids by name, and find-or-creates a city/community
 * (mirroring what the reference-options + profile-update endpoints do)
 * so tests exercise the same code paths a real client would. */
export async function resolveReferenceIds(): Promise<ReferenceIds> {
  const [religions, motherTongues, educations, professions, maritalStatuses, countries] = await Promise.all([
    referenceRepo.listReligions(),
    referenceRepo.listMotherTongues(),
    referenceRepo.listEducations(),
    referenceRepo.listProfessions(),
    referenceRepo.listMaritalStatuses(),
    referenceRepo.listCountries(),
  ]);

  const religion = religions.find((r) => r.name === "Hindu") ?? religions[0];
  const motherTongue = motherTongues.find((m) => m.name === "Hindi") ?? motherTongues[0];
  const education = educations.find((e) => e.name.startsWith("Bachelor's")) ?? educations[0];
  const profession = professions.find((p) => p.name === "Software Engineer") ?? professions[0];
  const maritalStatus = maritalStatuses.find((m) => m.name === "Never Married") ?? maritalStatuses[0];
  const country = countries.find((c) => c.name === "India") ?? countries[0];

  const city = await referenceRepo.findOrCreateCity("Mumbai", country.id);
  const community = await referenceRepo.findOrCreateCommunity("Test Community", religion.id);

  return {
    religionId: religion.id,
    motherTongueId: motherTongue.id,
    educationId: education.id,
    professionId: profession.id,
    maritalStatusId: maritalStatus.id,
    countryId: country.id,
    cityId: city.id,
    communityId: community.id,
  };
}

/** A minimal-but-complete PATCH /profiles/me body — every field the B3
 * completion checklist requires except the photo (uploaded separately). */
export function fullProfilePatchBody(refs: ReferenceIds) {
  return {
    religionId: refs.religionId,
    communityId: refs.communityId,
    motherTongueId: refs.motherTongueId,
    educationId: refs.educationId,
    professionId: refs.professionId,
    maritalStatusId: refs.maritalStatusId,
    countryId: refs.countryId,
    cityId: refs.cityId,
    incomeRange: "10-15 LPA",
    incomeCurrency: "INR",
    heightCm: 170,
  };
}

/** A tiny valid PNG (1x1, red pixel) as a Buffer — real PNG magic bytes
 * and a real (if minimal) IHDR chunk, so inspectImage() genuinely
 * recognizes it rather than the test relying on a mocked image library. */
export function tinyPngBuffer(width = 300, height = 300): Buffer {
  // We don't need real pixel data for the upload/validation tests — just
  // a byte-correct PNG signature + IHDR chunk carrying the width/height
  // our inspectImage() reader actually parses. The rest of the file
  // (IDAT/IEND) is a fixed minimal valid 1x1 PNG's tail, which is fine
  // since nothing in this codebase decodes pixel data, only the header.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR");
  const ihdrCrc = Buffer.alloc(4); // CRC not validated by our reader
  const ihdrChunk = Buffer.concat([ihdrLength, ihdrType, ihdrData, ihdrCrc]);

  // A minimal, real 1x1 IDAT + IEND tail (valid zlib stream for a single
  // black pixel) — content doesn't need to match the IHDR dimensions for
  // our header-only inspection, and nothing here re-decodes pixels.
  const idat = Buffer.from([
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00,
    0x01, 0x27, 0xa5, 0x74, 0x08,
  ]);
  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  return Buffer.concat([signature, ihdrChunk, idat, iend]);
}

export function makePhotoFormData(buffer: Buffer, filename = "photo.png", type = "image/png"): FormData {
  const form = new FormData();
  // See the photo-file route's own comment: Buffer's ArrayBufferLike
  // doesn't structurally satisfy BlobPart's ArrayBuffer in this
  // TS/@types/node combination, even though the bytes are fine.
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type });
  form.set("photo", blob, filename);
  return form;
}

// ---------------------------------------------------------------------------
// B4 additions below — everything above this line is unchanged B3 code.
// ---------------------------------------------------------------------------

import { POST as createProfileRoute, PATCH as updateProfileRoute } from "@/app/api/v1/profiles/me/route";
import { POST as uploadPhotoRoute } from "@/app/api/v1/profiles/me/photos/route";

export interface BuildReadyProfileOptions {
  gender?: "MALE" | "FEMALE";
  dateOfBirth?: string;
  religionId?: string;
  communityId?: string;
  motherTongueId?: string;
  educationId?: string;
  professionId?: string;
  maritalStatusId?: string;
  countryId?: string;
  cityId?: string;
  heightCm?: number;
  incomeCurrency?: string;
  incomeMinAmount?: number;
  incomeMaxAmount?: number;
  /** Skip the photo upload — leaves the profile at COMPLETE, not
   * READY_FOR_VISIBILITY (used by the "incomplete profiles excluded from
   * search" test group). */
  skipPhoto?: boolean;
}

export interface ReadyProfile {
  member: TestMember;
  profileId: string;
  photoId: string | null;
}

/** Builds a fully-complete, READY_FOR_VISIBILITY profile (every B3
 * required field + a photo, by default) with real seeded reference data —
 * the shared fixture B4's search/preferences tests build a small
 * population of distinct profiles out of, via real route handlers end to
 * end (register -> create profile -> patch -> upload photo), matching
 * the same "no mocking" posture as every other B1-B3 test. */
export async function buildReadyProfile(namePrefix: string, refs: ReferenceIds, opts: BuildReadyProfileOptions = {}): Promise<ReadyProfile> {
  const member = await createVerifiedMember(namePrefix);
  const createRes = await createProfileRoute(
    req(
      "http://localhost/api/v1/profiles/me",
      { gender: opts.gender ?? "FEMALE", dateOfBirth: opts.dateOfBirth ?? "1994-03-10" },
      { token: member.sessionToken }
    )
  );
  const { data: createData } = await createRes.json();

  const patchBody: Record<string, unknown> = {
    religionId: opts.religionId ?? refs.religionId,
    communityId: opts.communityId ?? refs.communityId,
    motherTongueId: opts.motherTongueId ?? refs.motherTongueId,
    educationId: opts.educationId ?? refs.educationId,
    professionId: opts.professionId ?? refs.professionId,
    maritalStatusId: opts.maritalStatusId ?? refs.maritalStatusId,
    countryId: opts.countryId ?? refs.countryId,
    cityId: opts.cityId ?? refs.cityId,
    incomeRange: "10-15 LPA",
    incomeCurrency: opts.incomeCurrency ?? "INR",
    heightCm: opts.heightCm ?? 170,
  };
  if (opts.incomeMinAmount !== undefined) patchBody.incomeMinAmount = opts.incomeMinAmount;
  if (opts.incomeMaxAmount !== undefined) patchBody.incomeMaxAmount = opts.incomeMaxAmount;

  const patchRes = await updateProfileRoute(req("http://localhost/api/v1/profiles/me", patchBody, { token: member.sessionToken, method: "PATCH" }));
  if (patchRes.status !== 200) {
    // Fail loudly rather than silently leaving the test population
    // half-built (e.g. a caller overrode religionId without also
    // overriding communityId to one that belongs to it) — a search test
    // asserting on wrong/missing data is far more confusing to debug.
    const body = await patchRes.json().catch(() => ({}));
    throw new Error(`buildReadyProfile(${namePrefix}): PATCH /profiles/me failed (${patchRes.status}): ${JSON.stringify(body)}`);
  }

  let photoId: string | null = null;
  if (!opts.skipPhoto) {
    const photoRes = await uploadPhotoRoute(
      new NextRequest("http://localhost/api/v1/profiles/me/photos", {
        method: "POST",
        headers: { authorization: `Bearer ${member.sessionToken}` },
        body: makePhotoFormData(tinyPngBuffer(300, 300)),
      })
    );
    const { data: photoData } = await photoRes.json();
    photoId = photoData.photo.id as string;
  }

  return { member, profileId: createData.profile.id as string, photoId };
}
