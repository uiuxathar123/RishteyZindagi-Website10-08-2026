import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import type { AuthContext } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { created, ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError, NotFoundError } from "@/server/lib/errors";
import { getStorageProvider } from "@/server/modules/storage/factory";
import * as profilesService from "./profiles.service";

const createProfileSchema = z.object({
  gender: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "dateOfBirth must be a valid date"),
  aboutMe: z.string().max(2000).optional(),
  heightCm: z.number().int().min(90).max(250).optional(),
});

export async function createMyProfileHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const body = await parseJsonBody(req, createProfileSchema);
  const profile = await profilesService.createMyProfile(ctx, body);
  return created({ profile }, "Profile created.");
}

export async function getMyProfileHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const profile = await profilesService.getMyProfile(ctx);
  return ok({ profile });
}

// ---------------------------------------------------------------------------
// B3 additions below — everything above this line is unchanged B1 code.
// ---------------------------------------------------------------------------

/** Soft authentication for the one route that must accept both signed-in
 * and anonymous callers (GET /profiles/:profileId) — never throws. This
 * does not modify or duplicate authenticate()'s own logic, it only
 * catches the AuthenticationError it throws for "no/invalid session" and
 * treats that as "anonymous visitor" instead of a request failure. */
async function tryAuthenticate(req: NextRequest): Promise<AuthContext | null> {
  try {
    return await authenticate(req);
  } catch {
    return null;
  }
}

function ipKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Validates Next.js's dynamic-route params object the same way
 * parseJsonBody validates a request body — throwing a ValidationError
 * (caught centrally by the error-handler middleware) instead of a raw
 * ZodError, which withErrorHandling would otherwise turn into an opaque
 * 500 instead of a proper 400. */
function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const lifestyleSchema = z
  .object({
    diet: z.enum(["VEGETARIAN", "NON_VEGETARIAN", "VEGAN", "EGGETARIAN", "JAIN"]).optional(),
    smoking: z.enum(["NO", "OCCASIONALLY", "YES"]).optional(),
    drinking: z.enum(["NO", "OCCASIONALLY", "YES"]).optional(),
    disability: z.string().max(200).optional(),
  })
  .strict()
  .optional();

const familyDetailsSchema = z
  .object({
    familyType: z.enum(["NUCLEAR", "JOINT"]).optional(),
    familyValues: z.enum(["TRADITIONAL", "MODERATE", "LIBERAL"]).optional(),
    fatherOccupation: z.string().max(200).optional(),
    motherOccupation: z.string().max(200).optional(),
    siblings: z.number().int().min(0).max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict()
  .optional();

const uuidField = z.string().uuid();

const updateProfileSchema = z
  .object({
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    dateOfBirth: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "dateOfBirth must be a valid date")
      .refine((v) => {
        const age = (Date.now() - Date.parse(v)) / (1000 * 60 * 60 * 24 * 365.25);
        return age >= 18 && age <= 100;
      }, "dateOfBirth must correspond to an age between 18 and 100")
      .optional(),
    maritalStatusId: uuidField.optional(),
    religionId: uuidField.optional(),
    communityId: uuidField.optional(),
    motherTongueId: uuidField.optional(),
    motherTongueIds: z.array(uuidField).max(10).optional(),
    educationId: uuidField.optional(),
    educationIds: z.array(uuidField).max(10).optional(),
    professionId: uuidField.optional(),
    professionIds: z.array(uuidField).max(10).optional(),
    incomeRange: z.string().trim().min(1).max(100).optional(),
    incomeCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "incomeCurrency must be a 3-letter ISO 4217 code")
      .optional(),
    // B4: optional structured counterparts to incomeRange, needed for
    // database-level income search (see schema.ts's comment on
    // profiles.incomeMinAmount). Independent of incomeRange/incomeCurrency
    // — a caller may set one, both, or neither.
    incomeMinAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    incomeMaxAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    heightCm: z.number().int().min(90).max(250).optional(),
    countryId: uuidField.optional(),
    cityId: uuidField.optional(),
    aboutMe: z.string().max(2000).optional(),
    lifestyle: lifestyleSchema,
    familyDetails: familyDetailsSchema,
  })
  .strict()
  .refine(
    (v) => v.incomeMinAmount === undefined || v.incomeMaxAmount === undefined || v.incomeMinAmount <= v.incomeMaxAmount,
    { message: "incomeMinAmount must be less than or equal to incomeMaxAmount.", path: ["incomeMinAmount"] }
  );

export async function updateMyProfileHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`profile-update:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, updateProfileSchema);
  const profile = await profilesService.updateMyProfile(ctx, body);
  return ok({ profile }, "Profile updated.");
}

export async function getMyProfileCompletionHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const result = await profilesService.getMyProfileCompletion(ctx);
  return ok(result);
}

// --- Photos ---------------------------------------------------------------

export async function listMyPhotosHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const photos = await profilesService.listMyPhotos(ctx);
  return ok({ photos });
}

export async function uploadMyPhotoHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`photo-upload:${ctx.subject.id}`, 20, 60_000);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("Expected multipart/form-data with a 'photo' file field.");
  }
  const file = form.get("photo");
  if (!file || !(file instanceof File)) {
    throw new ValidationError("Missing 'photo' file field.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const photo = await profilesService.uploadMyPhoto(ctx, {
    buffer,
    declaredFilename: file.name || null,
    declaredSizeBytes: file.size,
  });
  return created({ photo }, "Photo uploaded.");
}

const primaryPhotoParamsSchema = z.object({ photoId: uuidField });

export async function setMyPrimaryPhotoHandler(req: NextRequest, params: { photoId: string }) {
  const ctx = await authenticate(req);
  const { photoId } = parseParams(primaryPhotoParamsSchema, params);
  const photos = await profilesService.setMyPrimaryPhoto(ctx, photoId);
  return ok({ photos }, "Primary photo updated.");
}

const reorderPhotosSchema = z.object({ photoIds: z.array(uuidField).min(1) });

export async function reorderMyPhotosHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const body = await parseJsonBody(req, reorderPhotosSchema);
  const photos = await profilesService.reorderMyPhotos(ctx, body.photoIds);
  return ok({ photos }, "Photos reordered.");
}

const deletePhotoParamsSchema = z.object({ photoId: uuidField });

export async function deleteMyPhotoHandler(req: NextRequest, params: { photoId: string }) {
  const ctx = await authenticate(req);
  const { photoId } = parseParams(deletePhotoParamsSchema, params);
  const result = await profilesService.deleteMyPhoto(ctx, photoId);
  return ok(result, "Photo deleted.");
}

const photoFileParamsSchema = z.object({ photoId: uuidField });

/** Returns a raw StorageReadResult (buffer + contentType) rather than the
 * ok()/fail() JSON envelope — this is the one route in the codebase that
 * serves a binary file, a deliberate, documented exception to
 * response.ts's "every response goes through ok()/fail()" rule (that
 * rule is about never hand-building a *JSON* response; this isn't one).
 * The actual NextResponse is built in the route file, which needs the
 * Node-only `Buffer`->stream conversion. */
export async function getPhotoFileHandler(
  req: NextRequest,
  params: { photoId: string }
): Promise<{ buffer: Buffer; contentType: string }> {
  const { photoId } = parseParams(photoFileParamsSchema, params);
  const ctx = await authenticate(req); // no anonymous photo access — see B3 §10/§16
  const access = await profilesService.authorizePhotoFileAccess(ctx, photoId);

  const file = await getStorageProvider().read(access.storageKey);
  if (!file) throw new NotFoundError("Photo not found.");
  return { buffer: file.buffer, contentType: access.mimeType };
}

// --- Public / gated profile -------------------------------------------

const profileIdParamsSchema = z.object({ profileId: uuidField });

export async function getPublicProfileHandler(req: NextRequest, params: { profileId: string }) {
  const { profileId } = parseParams(profileIdParamsSchema, params);
  const viewer = await tryAuthenticate(req);
  const result = await profilesService.getPublicProfile(viewer, profileId);
  return ok(result);
}

// --- Batched list-card summaries ----------------------------------------

const summariesQuerySchema = z.object({
  ids: z
    .string()
    .min(1)
    .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(uuidField).min(1).max(profilesService.MAX_PROFILE_SUMMARY_IDS)),
});

export async function getProfileSummariesHandler(req: NextRequest) {
  const ctx = await authenticate(req); // members only; anonymous callers get the normal 401
  const { ids } = parseParams(summariesQuerySchema, { ids: new URL(req.url).searchParams.get("ids") ?? "" });
  const items = await profilesService.getProfileSummaries(ctx, ids);
  return ok({ items });
}

// --- Admin verification foundation --------------------------------------

const verifyProfileParamsSchema = z.object({ profileId: uuidField });
const verifyProfileBodySchema = z.object({
  status: z.enum(["UNVERIFIED", "VERIFIED", "REJECTED"]),
  notes: z.string().max(1000).optional(),
});

export async function verifyProfileHandler(req: NextRequest, params: { profileId: string }) {
  const ctx = await authenticate(req);
  const { profileId } = parseParams(verifyProfileParamsSchema, params);
  const body = await parseJsonBody(req, verifyProfileBodySchema);
  const profile = await profilesService.verifyProfile(ctx, profileId, body);
  return ok({ profile }, "Profile verification updated.");
}

// --- Reference / lookup options -----------------------------------------

const referenceOptionsQuerySchema = z.object({
  countryId: uuidField.optional(),
  religionId: uuidField.optional(),
});

export async function getProfileReferenceOptionsHandler(req: NextRequest) {
  checkRateLimit(`reference-options:${ipKey(req)}`, 120, 60_000);
  const url = new URL(req.url);
  const { countryId, religionId } = referenceOptionsQuerySchema.parse({
    countryId: url.searchParams.get("countryId") ?? undefined,
    religionId: url.searchParams.get("religionId") ?? undefined,
  });
  const options = await profilesService.getProfileReferenceOptions(countryId, religionId);
  return ok(options);
}
