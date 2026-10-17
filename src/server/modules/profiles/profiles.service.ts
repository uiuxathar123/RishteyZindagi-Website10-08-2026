/**
 * Profile foundation (B1 §4). Only covers create-once + read-your-own —
 * editing, photo upload, verification workflow, and partner-preference
 * management are explicitly B2+ (matching/recommendations/search all
 * need a stable, tested Profile row to point at first).
 */
import { randomUUID } from "crypto";
import { ConflictError, NotFoundError, AuthorizationError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
// B6 (disclosed, additive, required dependency — see BACKEND.md's B6
// section for the full 4-part disclosure): the only genuinely necessary
// hook point for a real PROFILE_VIEW behaviour event is this file's
// existing getPublicProfile — there is no other read path for a profile
// view. The import is best-effort (recordEvent never throws) and the
// call site below is a single, narrow addition; nothing else in this
// file changes.
import { recordEvent } from "@/server/modules/behaviour-events/behaviour-events.service";
// B10 (disclosed, additive, required security fix — see BACKEND.md's B10
// section): getPublicProfile below never checked block status at all —
// B4 search and B5 recommendations both correctly exclude a blocked pair
// bidirectionally (see BACKEND.md's B6 §50.8), but a direct
// `GET /profiles/:profileId` by id was not gated the same way, so a
// blocked party could still view the other's full authenticated profile
// by navigating straight to a profileId they already had (e.g. from
// before the block, or from chat history). Reuses B6's own existing
// `isBlockedEitherDirection` — no new query/logic invented.
import { acceptedPartnerIds, isAcceptedPartner, viewerExtrasFor } from "./privacy";
import { blockedUserIdsAmong, isBlockedEitherDirection } from "@/server/modules/interactions/interactions.repository";
import { getStorageProvider } from "@/server/modules/storage/factory";
import { inspectImage } from "@/server/modules/storage/image-inspect";
import * as profilesRepo from "./profiles.repository";
import type { ProfileRow, ProfilePhotoRow, ProfileUpdate } from "./profiles.repository";
import { getApprovalSettings } from "@/server/modules/platform-settings/platform-settings.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as referenceRepo from "./reference.repository";
import type { LookupRow } from "./reference.repository";
import { computeCompletion } from "./completion";
import {
  toOwnerProfileView,
  toAuthenticatedPublicView,
  toAnonymousGatedView,
  toOwnerPhotoView,
  type OwnerProfileView,
  type OwnerPhotoView,
  type AuthenticatedPublicProfileView,
  type AnonymousGatedProfileView,
  type ResolvedLookups,
} from "./profiles.dto";

export interface CreateProfileInput {
  gender: "MALE" | "FEMALE";
  dateOfBirth: string; // ISO date
  aboutMe?: string;
  heightCm?: number;
}

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

export async function createMyProfile(ctx: AuthContext, input: CreateProfileInput): Promise<ProfileRow> {
  const userId = requireMemberSubject(ctx);

  const existing = await profilesRepo.findByUserId(userId);
  if (existing) throw new ConflictError("A profile already exists for this account.");

  return profilesRepo.create({
    userId,
    gender: input.gender,
    dateOfBirth: new Date(input.dateOfBirth),
    aboutMe: input.aboutMe,
    heightCm: input.heightCm,
  });
}

export async function getMyProfile(ctx: AuthContext): Promise<ProfileRow> {
  const userId = requireMemberSubject(ctx);
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("No profile exists for this account yet.");
  return profile;
}

// ---------------------------------------------------------------------------
// B3 additions below — everything above this line is unchanged B1 code
// (createMyProfile / getMyProfile keep their original behavior and
// response shape untouched; new capabilities are added as new exports).
// ---------------------------------------------------------------------------

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const MIN_PHOTO_DIMENSION = 200; // px, only enforced when we could parse dimensions
const MAX_PHOTOS_PER_PROFILE = 10;

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function requireOwnedProfile(ctx: AuthContext): Promise<ProfileRow> {
  const userId = requireMemberSubject(ctx);
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("No profile exists for this account yet. Create one first.");
  return profile;
}

// B4: exported (was previously module-private) so search.service.ts can
// reuse the exact same lookup-resolution + DTO mapping (toAuthenticatedPublicView
// / toAnonymousGatedView) that getPublicProfile below already uses — the
// B4 brief explicitly requires reusing B3's privacy boundary rather than
// building a second, possibly-inconsistent implementation of it. Nothing
// about this function's behavior changed; only its visibility.
export async function resolveLookups(profile: ProfileRow): Promise<ResolvedLookups> {
  const [maritalStatus, religion, community, motherTongue, education, profession, country, city] = await Promise.all([
    profile.maritalStatusId ? referenceRepo.getMaritalStatusById(profile.maritalStatusId) : Promise.resolve(undefined),
    profile.religionId ? referenceRepo.getReligionById(profile.religionId) : Promise.resolve(undefined),
    profile.communityId ? referenceRepo.getCommunityById(profile.communityId) : Promise.resolve(undefined),
    profile.motherTongueId ? referenceRepo.getMotherTongueById(profile.motherTongueId) : Promise.resolve(undefined),
    profile.educationId ? referenceRepo.getEducationById(profile.educationId) : Promise.resolve(undefined),
    profile.professionId ? referenceRepo.getProfessionById(profile.professionId) : Promise.resolve(undefined),
    profile.countryId ? referenceRepo.getCountryById(profile.countryId) : Promise.resolve(undefined),
    profile.cityId ? referenceRepo.getCityById(profile.cityId) : Promise.resolve(undefined),
  ]);
  return {
    maritalStatus: maritalStatus ?? null,
    religion: religion ?? null,
    community: community ?? null,
    motherTongue: motherTongue ?? null,
    education: education ?? null,
    profession: profession ?? null,
    country: country ?? null,
    city: city ?? null,
  };
}

/** Batched form of resolveLookups for a page of profiles: one query per lookup table that is
 * actually needed (none at all for an empty page) instead of up to eight per profile. Returns an
 * entry for every given profile, with exactly the values resolveLookups would return for it. */
export async function resolveLookupsForProfiles(profileRows: ProfileRow[]): Promise<Map<string, ResolvedLookups>> {
  const need = (pick: (p: ProfileRow) => string | null) => [...new Set(profileRows.map(pick).filter((x): x is string => !!x))];
  const maps = await referenceRepo.getLookupMapsByIds({
    maritalStatus: need((p) => p.maritalStatusId),
    religion: need((p) => p.religionId),
    community: need((p) => p.communityId),
    motherTongue: need((p) => p.motherTongueId),
    education: need((p) => p.educationId),
    profession: need((p) => p.professionId),
    country: need((p) => p.countryId),
    city: need((p) => p.cityId),
  });
  const out = new Map<string, ResolvedLookups>();
  for (const p of profileRows) {
    out.set(p.id, {
      maritalStatus: (p.maritalStatusId && maps.maritalStatus.get(p.maritalStatusId)) || null,
      religion: (p.religionId && maps.religion.get(p.religionId)) || null,
      community: (p.communityId && maps.community.get(p.communityId)) || null,
      motherTongue: (p.motherTongueId && maps.motherTongue.get(p.motherTongueId)) || null,
      education: (p.educationId && maps.education.get(p.educationId)) || null,
      profession: (p.professionId && maps.profession.get(p.professionId)) || null,
      country: (p.countryId && maps.country.get(p.countryId)) || null,
      city: (p.cityId && maps.city.get(p.cityId)) || null,
    });
  }
  return out;
}

/** Recomputes and persists profileCompletionPercent / missingRequiredFields
 * / hasProfilePhoto / profileStatus from the current row + live photo
 * count. Called after every mutation that could change any of them
 * (profile field update, photo add/delete) — see completion.ts for the
 * pure calculation. GET responses additionally compute this live (via the
 * DTOs) so a response is never stale even for a profile created before
 * its first recompute (see createMyProfile's note in BACKEND.md). */
async function recomputeProfileState(profileId: string): Promise<ProfileRow> {
  const profile = await profilesRepo.findById(profileId);
  if (!profile) throw new NotFoundError("Profile not found.");
  const photoCount = await profilesRepo.countPhotos(profileId);
  const result = computeCompletion(profile, photoCount > 0);
  // B19: the first time a profile becomes READY it is either auto-approved (switch off — the default) or put in the
  // manual-approval queue (switch on). A profile that has already been decided is never re-queued.
  let approval: Partial<ProfileUpdate> = {};
  if (result.profileStatus === "READY_FOR_VISIBILITY" && !profile.approvalDecidedAt) {
    const manual = (await getApprovalSettings()).manualApproval;
    approval = manual ? { approvalStatus: "PENDING" } : { approvalStatus: "APPROVED", approvalDecidedAt: new Date() };
  } else if (result.profileStatus === "READY_FOR_VISIBILITY" && profile.approvalStatus === "REJECTED") {
    // A member who edits a rejected profile resubmits it: it goes back to the queue (never straight to visible).
    approval = { approvalStatus: "PENDING" };
  }
  const updated = await profilesRepo.update(profileId, {
    profileCompletionPercent: result.profileCompletionPercent,
    missingRequiredFields: result.missingRequiredFields,
    hasProfilePhoto: result.hasProfilePhoto,
    profileStatus: result.profileStatus,
    ...approval,
  });
  if (approval.approvalStatus === "PENDING" && profile.approvalStatus !== "PENDING") {
    await notify({
      userId: profile.userId,
      channel: "IN_APP",
      title: "Your profile is under review",
      body: "Thank you for completing your profile. It will appear to other members as soon as our team approves it.",
      dedupeKey: `profile_pending:${profile.id}`,
    });
  }
  return updated;
}

// --- GET current user's complete profile (owner view) -------------------

export async function getMyProfileDetailed(ctx: AuthContext): Promise<OwnerProfileView> {
  const userId = requireMemberSubject(ctx);
  const found = await profilesRepo.findByUserIdWithAccount(userId);
  if (!found) throw new NotFoundError("No profile exists for this account yet.");
  const [lookups, photos] = await Promise.all([
    resolveLookups(found.profile),
    profilesRepo.listPhotos(found.profile.id),
  ]);
  return toOwnerProfileView(found.profile, found.displayName, lookups, photos);
}

// --- Update profile -------------------------------------------------------

export interface UpdateProfileInput {
  gender?: "MALE" | "FEMALE";
  dateOfBirth?: string;
  maritalStatusId?: string;
  religionId?: string;
  communityId?: string;
  motherTongueId?: string;
  motherTongueIds?: string[];
  educationId?: string;
  educationIds?: string[];
  professionId?: string;
  professionIds?: string[];
  incomeRange?: string;
  incomeCurrency?: string;
  // B4: structured numeric counterparts to incomeRange — see schema.ts's
  // comment on profiles.incomeMinAmount for why these were added. Optional
  // and independent of incomeRange; not part of profile completion.
  incomeMinAmount?: number;
  incomeMaxAmount?: number;
  heightCm?: number;
  countryId?: string;
  cityId?: string;
  aboutMe?: string;
  lifestyle?: Record<string, unknown>;
  familyDetails?: Record<string, unknown>;
}

async function validateReferencedIds(input: UpdateProfileInput, current: ProfileRow): Promise<void> {
  if (input.religionId && !(await referenceRepo.religionExists(input.religionId))) {
    throw new ValidationError("religionId does not reference a known religion.");
  }
  if (input.motherTongueId && !(await referenceRepo.motherTongueExists(input.motherTongueId))) {
    throw new ValidationError("motherTongueId does not reference a known mother tongue.");
  }
  if (input.educationId && !(await referenceRepo.educationExists(input.educationId))) {
    throw new ValidationError("educationId does not reference a known education value.");
  }
  if (input.professionId && !(await referenceRepo.professionExists(input.professionId))) {
    throw new ValidationError("professionId does not reference a known profession.");
  }
  if (input.maritalStatusId && !(await referenceRepo.maritalStatusExists(input.maritalStatusId))) {
    throw new ValidationError("maritalStatusId does not reference a known marital status.");
  }
  if (input.countryId && !(await referenceRepo.countryExists(input.countryId))) {
    throw new ValidationError("countryId does not reference a known country.");
  }

  if (input.cityId) {
    const countryId = input.countryId ?? current.countryId;
    if (!countryId) {
      throw new ValidationError("cityId was provided without a countryId (and the profile has none set yet).");
    }
    if (!(await referenceRepo.cityBelongsToCountry(input.cityId, countryId))) {
      throw new ValidationError("cityId does not belong to the given countryId.");
    }
  }

  if (input.communityId) {
    const religionId = input.religionId ?? current.religionId;
    if (!religionId) {
      throw new ValidationError("communityId was provided without a religionId (and the profile has none set yet).");
    }
    if (!(await referenceRepo.communityBelongsToReligion(input.communityId, religionId))) {
      throw new ValidationError("communityId does not belong to the given religionId.");
    }
    // B18: a community an admin retired can't be newly picked (keeping the one already on the profile is fine).
    if (input.communityId !== current.communityId && !(await referenceRepo.communityIsActive(input.communityId))) {
      throw new ValidationError("This community is no longer available. Please choose another.");
    }
  }

  for (const [field, ids, checker] of [
    ["motherTongueIds", input.motherTongueIds, referenceRepo.motherTongueExists],
    ["educationIds", input.educationIds, referenceRepo.educationExists],
    ["professionIds", input.professionIds, referenceRepo.professionExists],
  ] as const) {
    if (!ids) continue;
    for (const id of ids) {
      if (!(await checker(id))) throw new ValidationError(`${field} contains an id that does not exist: ${id}`);
    }
  }
}

export async function updateMyProfile(ctx: AuthContext, input: UpdateProfileInput): Promise<OwnerProfileView> {
  const profile = await requireOwnedProfile(ctx);
  await validateReferencedIds(input, profile);

  const changedKeys = Object.keys(input);
  await profilesRepo.update(profile.id, {
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(input.dateOfBirth !== undefined ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
    ...(input.maritalStatusId !== undefined ? { maritalStatusId: input.maritalStatusId } : {}),
    ...(input.religionId !== undefined ? { religionId: input.religionId } : {}),
    ...(input.communityId !== undefined ? { communityId: input.communityId } : {}),
    ...(input.motherTongueId !== undefined ? { motherTongueId: input.motherTongueId } : {}),
    ...(input.motherTongueIds !== undefined ? { motherTongueIds: input.motherTongueIds } : {}),
    ...(input.educationId !== undefined ? { educationId: input.educationId } : {}),
    ...(input.educationIds !== undefined ? { educationIds: input.educationIds } : {}),
    ...(input.professionId !== undefined ? { professionId: input.professionId } : {}),
    ...(input.professionIds !== undefined ? { professionIds: input.professionIds } : {}),
    ...(input.incomeRange !== undefined ? { incomeRange: input.incomeRange } : {}),
    ...(input.incomeCurrency !== undefined ? { incomeCurrency: input.incomeCurrency } : {}),
    ...(input.incomeMinAmount !== undefined ? { incomeMinAmount: input.incomeMinAmount } : {}),
    ...(input.incomeMaxAmount !== undefined ? { incomeMaxAmount: input.incomeMaxAmount } : {}),
    ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
    ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
    ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
    ...(input.aboutMe !== undefined ? { aboutMe: input.aboutMe } : {}),
    ...(input.lifestyle !== undefined ? { lifestyle: input.lifestyle } : {}),
    ...(input.familyDetails !== undefined ? { familyDetails: input.familyDetails } : {}),
  });

  await recomputeProfileState(profile.id);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "profile.updated",
    entityType: "profile",
    entityId: profile.id,
    metadata: { changedFields: changedKeys },
  });

  return getMyProfileDetailed(ctx);
}

// --- Completion -------------------------------------------------------

export interface CompletionSummary {
  profileCompletionPercent: number;
  missingRequiredFields: string[];
  profileStatus: string;
  isReadyForVisibility: boolean;
  profile: OwnerProfileView;
}

export async function getMyProfileCompletion(ctx: AuthContext): Promise<CompletionSummary> {
  const detailed = await getMyProfileDetailed(ctx);
  return {
    profileCompletionPercent: detailed.profileCompletionPercent,
    missingRequiredFields: detailed.missingRequiredFields,
    profileStatus: detailed.profileStatus,
    isReadyForVisibility: detailed.isReadyForVisibility,
    profile: detailed,
  };
}

// --- Photos -----------------------------------------------------------

export interface UploadPhotoInput {
  buffer: Buffer;
  declaredFilename: string | null;
  declaredSizeBytes: number;
}

export async function listMyPhotos(ctx: AuthContext): Promise<OwnerPhotoView[]> {
  const profile = await requireOwnedProfile(ctx);
  const photos = await profilesRepo.listPhotos(profile.id);
  return photos.map(toOwnerPhotoView);
}

export async function uploadMyPhoto(ctx: AuthContext, input: UploadPhotoInput): Promise<OwnerPhotoView> {
  const profile = await requireOwnedProfile(ctx);

  if (input.declaredSizeBytes > MAX_PHOTO_BYTES || input.buffer.length > MAX_PHOTO_BYTES) {
    throw new ValidationError(`Photo exceeds the maximum allowed size of ${MAX_PHOTO_BYTES / (1024 * 1024)}MB.`);
  }
  if (input.buffer.length === 0) {
    throw new ValidationError("Uploaded file is empty.");
  }

  const existingCount = await profilesRepo.countPhotos(profile.id);
  if (existingCount >= MAX_PHOTOS_PER_PROFILE) {
    throw new ConflictError(`A profile can have at most ${MAX_PHOTOS_PER_PROFILE} photos.`);
  }

  const detected = inspectImage(input.buffer);
  if (!detected) {
    throw new ValidationError("Unsupported or invalid image file. Only JPEG, PNG, and WEBP are accepted.");
  }
  if (
    detected.width !== null &&
    detected.height !== null &&
    (detected.width < MIN_PHOTO_DIMENSION || detected.height < MIN_PHOTO_DIMENSION)
  ) {
    throw new ValidationError(`Image must be at least ${MIN_PHOTO_DIMENSION}x${MIN_PHOTO_DIMENSION} pixels.`);
  }

  const photoId = randomUUID();
  const extension = CONTENT_TYPE_EXTENSION[detected.contentType] ?? "bin";
  const storageKey = `photos/${profile.id}/${photoId}.${extension}`;

  const storage = getStorageProvider();
  await storage.upload({ key: storageKey, buffer: input.buffer, contentType: detected.contentType });

  const isPrimary = existingCount === 0;
  const nextSortOrder = (await profilesRepo.maxSortOrder(profile.id)) + 1;

  const photo = await profilesRepo.createPhoto({
    id: photoId,
    profileId: profile.id,
    url: `/api/v1/profiles/photos/${photoId}/file`,
    storageKey,
    originalFilename: input.declaredFilename,
    mimeType: detected.contentType,
    fileSizeBytes: input.buffer.length,
    width: detected.width,
    height: detected.height,
    uploadStatus: "COMPLETE",
    isPrimary,
    sortOrder: nextSortOrder,
  });

  await recomputeProfileState(profile.id);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "profile_photo.uploaded",
    entityType: "profile_photo",
    entityId: photo.id,
    metadata: { profileId: profile.id, mimeType: photo.mimeType, fileSizeBytes: photo.fileSizeBytes, isPrimary },
  });

  return toOwnerPhotoView(photo);
}

async function loadOwnedPhoto(ctx: AuthContext, photoId: string): Promise<{ profile: ProfileRow; photo: ProfilePhotoRow }> {
  const profile = await requireOwnedProfile(ctx);
  const photo = await profilesRepo.findPhotoById(photoId);
  if (!photo || photo.profileId !== profile.id) {
    // Deliberately the same AuthorizationError shape whether the photo
    // doesn't exist at all or belongs to someone else — see B3 §21 (IDOR):
    // neither case should let a caller distinguish "not yours" from
    // "doesn't exist".
    throw new AuthorizationError("You do not have permission to manage this photo.");
  }
  return { profile, photo };
}

export async function setMyPrimaryPhoto(ctx: AuthContext, photoId: string): Promise<OwnerPhotoView[]> {
  const { profile } = await loadOwnedPhoto(ctx, photoId);
  await profilesRepo.setPrimaryPhoto(profile.id, photoId);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "profile_photo.primary_changed",
    entityType: "profile_photo",
    entityId: photoId,
    metadata: { profileId: profile.id },
  });

  const photos = await profilesRepo.listPhotos(profile.id);
  return photos.map(toOwnerPhotoView);
}

export async function reorderMyPhotos(ctx: AuthContext, photoIds: string[]): Promise<OwnerPhotoView[]> {
  const profile = await requireOwnedProfile(ctx);
  const existing = await profilesRepo.listPhotos(profile.id);

  const existingIds = new Set(existing.map((p) => p.id));
  const requestedIds = new Set(photoIds);
  const sameSet =
    existingIds.size === requestedIds.size && [...existingIds].every((id) => requestedIds.has(id));
  if (!sameSet) {
    throw new ValidationError("photoIds must include exactly the profile's existing photos, each exactly once.");
  }

  await profilesRepo.reorderPhotos(profile.id, photoIds);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "profile_photo.reordered",
    entityType: "profile",
    entityId: profile.id,
    metadata: { photoIds },
  });

  const photos = await profilesRepo.listPhotos(profile.id);
  return photos.map(toOwnerPhotoView);
}

export async function deleteMyPhoto(ctx: AuthContext, photoId: string): Promise<{ deleted: true; newPrimaryPhotoId: string | null }> {
  const { profile, photo } = await loadOwnedPhoto(ctx, photoId);
  const wasPrimary = photo.isPrimary;

  if (photo.storageKey) {
    try {
      await getStorageProvider().delete(photo.storageKey);
    } catch {
      // Best-effort, same posture as audit logging / session lastSeenAt —
      // a storage cleanup failure must never block the user's delete
      // action from completing. An orphaned object is a minor storage
      // cost, not a data-integrity or security problem.
    }
  }

  await profilesRepo.deletePhoto(photoId);

  let newPrimaryPhotoId: string | null = null;
  if (wasPrimary) {
    const remaining = await profilesRepo.listPhotos(profile.id);
    if (remaining.length > 0) {
      await profilesRepo.setPrimaryPhoto(profile.id, remaining[0].id);
      newPrimaryPhotoId = remaining[0].id;
    }
  }

  await recomputeProfileState(profile.id);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "profile_photo.deleted",
    entityType: "profile_photo",
    entityId: photoId,
    metadata: { profileId: profile.id, wasPrimary, newPrimaryPhotoId },
  });

  return { deleted: true, newPrimaryPhotoId };
}

// --- Public / gated profile view --------------------------------------

export type PublicProfileView =
  | { audience: "owner" | "admin"; profile: OwnerProfileView }
  | { audience: "authenticated"; profile: AuthenticatedPublicProfileView }
  | { audience: "anonymous"; profile: AnonymousGatedProfileView };

/** GET /profiles/:profileId — picks the right response shape for the
 * caller. `viewer` is null for an unauthenticated request (see the
 * controller's tryAuthenticate, which never throws). Returns
 * NotFoundError for a nonexistent, inactive-account, or not-yet-ready
 * profile when the viewer isn't its owner or an admin — never leaking
 * *why* it's unavailable (B3 §9/§18). */
export async function getPublicProfile(viewer: AuthContext | null, profileId: string): Promise<PublicProfileView> {
  const found = await profilesRepo.findByIdWithAccount(profileId);
  if (!found) throw new NotFoundError("Profile not found.");

  const isOwner = !!viewer && viewer.subject.type === "user" && viewer.subject.id === found.profile.userId;
  const isAdmin = !!viewer && viewer.subject.type === "admin";

  const photoCount = await profilesRepo.countPhotos(found.profile.id);
  const isReady = computeCompletion(found.profile, photoCount > 0).profileStatus === "READY_FOR_VISIBILITY";

  if (!isOwner && !isAdmin) {
    if (found.userStatus !== "ACTIVE" || !isReady || found.profile.approvalStatus !== "APPROVED") {
      throw new NotFoundError("Profile not found.");
    }
    // B10: a blocked-either-direction pair gets the exact same 404 as
    // every other reason this profile isn't viewable to this caller —
    // never a distinct "you're blocked" signal (matching every other
    // IDOR-safe error in this codebase). Anonymous visitors have no
    // subject id to check a block against, so this only ever applies to
    // a signed-in member viewer.
    if (viewer && viewer.subject.type === "user" && (await isBlockedEitherDirection(viewer.subject.id, found.profile.userId))) {
      throw new NotFoundError("Profile not found.");
    }
    // B18: "hide my profile" — same 404 as every other unavailable reason; only an existing
    // ACCEPTED connection can still open it.
    if (found.profile.profileVisibility === "HIDDEN") {
      const partner = viewer && viewer.subject.type === "user" && (await isAcceptedPartner(viewer.subject.id, found.profile.userId));
      if (!partner) throw new NotFoundError("Profile not found.");
    }
  }

  const lookups = await resolveLookups(found.profile);

  if (isOwner || isAdmin) {
    const photos = await profilesRepo.listPhotos(found.profile.id);
    return {
      audience: isOwner ? "owner" : "admin",
      profile: toOwnerProfileView(found.profile, found.displayName, lookups, photos),
    };
  }

  if (viewer) {
    const photos = await profilesRepo.listPhotos(found.profile.id);
    // B6: a real PROFILE_VIEW event — only for a genuine "another member
    // looked at this profile" (viewer.subject.type === "user" is implied
    // by reaching this branch at all: isOwner/isAdmin were already
    // handled above, so `viewer` here is always a non-owner member).
    // Best-effort (recordEvent swallows its own errors internally, same
    // "never fail the primary action" contract as audit.service.ts's
    // record() — see behaviour-events.service.ts) but still awaited, so
    // the write is durable before this request completes, exactly like
    // every other audit/event call in this codebase.
    await recordEvent({ actorUserId: viewer.subject.id, targetUserId: found.profile.userId, eventType: "PROFILE_VIEW" });
    return {
      audience: "authenticated",
      profile: toAuthenticatedPublicView(
        found.profile,
        found.displayName,
        lookups,
        photos,
        viewer.subject.type === "user" ? (await viewerExtrasFor(viewer.subject.id, [found.profile])).get(found.profile.id) : undefined
      ),
    };
  }

  return {
    audience: "anonymous",
    profile: toAnonymousGatedView(found.profile, lookups, photoCount > 0),
  };
}

// --- Batched list-card summaries ----------------------------------------

export const MAX_PROFILE_SUMMARY_IDS = 50;

export type ProfileSummaryItem = { audience: "authenticated"; profile: AuthenticatedPublicProfileView };

/** GET /profiles/summaries?ids=… — the card data for many profiles in a handful of queries, for
 * interest / shortlist / match / chat lists. It applies EXACTLY the visibility rules of
 * getPublicProfile for a signed-in member (account ACTIVE, profile READY and APPROVED, no block in
 * either direction, HIDDEN profiles only for accepted partners, photos per the owner's setting) and
 * answers `null` for every id that single route would answer 404 (or that is the caller's own
 * profile) — never a reason. Unlike the single route it records NO PROFILE_VIEW event: rendering a
 * list is not "viewing" every person on it. Member sessions only. */
export async function getProfileSummaries(viewer: AuthContext, profileIds: string[]): Promise<Record<string, ProfileSummaryItem | null>> {
  const viewerUserId = requireMemberSubject(viewer);
  const ids = [...new Set(profileIds)];
  if (ids.length > MAX_PROFILE_SUMMARY_IDS) {
    throw new ValidationError(`At most ${MAX_PROFILE_SUMMARY_IDS} profiles can be requested at once.`);
  }
  const result: Record<string, ProfileSummaryItem | null> = Object.fromEntries(ids.map((id) => [id, null]));
  if (ids.length === 0) return result;

  const [found, photosByProfile] = await Promise.all([profilesRepo.findManyWithAccount(ids), profilesRepo.listPhotosForProfiles(ids)]);
  const others = found.filter((f) => f.profile.userId !== viewerUserId);
  const userIds = others.map((f) => f.profile.userId);

  const [blocked, partners] = await Promise.all([blockedUserIdsAmong(viewerUserId, userIds), acceptedPartnerIds(viewerUserId, userIds)]);

  const visible = others.filter((f) => {
    const photos = photosByProfile.get(f.profile.id) ?? [];
    const isReady = computeCompletion(f.profile, photos.length > 0).profileStatus === "READY_FOR_VISIBILITY";
    if (f.userStatus !== "ACTIVE" || !isReady || f.profile.approvalStatus !== "APPROVED") return false;
    if (blocked.has(f.profile.userId)) return false;
    if (f.profile.profileVisibility === "HIDDEN" && !partners.has(f.profile.userId)) return false;
    return true;
  });
  if (visible.length === 0) return result;

  const visibleProfiles = visible.map((f) => f.profile);
  const [lookupsByProfile, extras] = await Promise.all([resolveLookupsForProfiles(visibleProfiles), viewerExtrasFor(viewerUserId, visibleProfiles)]);

  for (const f of visible) {
    const p = f.profile;
    result[p.id] = {
      audience: "authenticated",
      profile: toAuthenticatedPublicView(p, f.displayName, lookupsByProfile.get(p.id)!, photosByProfile.get(p.id) ?? [], extras.get(p.id)),
    };
  }
  return result;
}

// --- Photo file delivery (gated) ---------------------------------------

export interface PhotoFileAccess {
  storageKey: string;
  mimeType: string;
}

/** Authorization check for GET /profiles/photos/:photoId/file — see B3
 * §16: owner always, any signed-in admin always (verification review),
 * any other authenticated user only if the photo's profile is
 * READY_FOR_VISIBILITY and its account is ACTIVE, and never anonymous. */
export async function authorizePhotoFileAccess(viewer: AuthContext | null, photoId: string): Promise<PhotoFileAccess> {
  if (!viewer) throw new AuthorizationError("Sign in to view profile photos.");

  const photo = await profilesRepo.findPhotoById(photoId);
  if (!photo || !photo.storageKey) throw new NotFoundError("Photo not found.");

  const found = await profilesRepo.findByIdWithAccount(photo.profileId);
  if (!found) throw new NotFoundError("Photo not found.");

  const isOwner = viewer.subject.type === "user" && viewer.subject.id === found.profile.userId;
  const isAdmin = viewer.subject.type === "admin";

  if (!isOwner && !isAdmin) {
    const photoCount = await profilesRepo.countPhotos(found.profile.id);
    const isReady = computeCompletion(found.profile, photoCount > 0).profileStatus === "READY_FOR_VISIBILITY";
    if (found.userStatus !== "ACTIVE" || !isReady || found.profile.approvalStatus !== "APPROVED") {
      throw new NotFoundError("Photo not found.");
    }
    // B18: hidden profile / accepted-connections-only photos. Same 404 as any unavailable photo.
    if (found.profile.profileVisibility === "HIDDEN" || found.profile.photoVisibility === "ACCEPTED_ONLY") {
      const partner = viewer.subject.type === "user" && (await isAcceptedPartner(viewer.subject.id, found.profile.userId));
      if (!partner) throw new NotFoundError("Photo not found.");
    }
  }

  return { storageKey: photo.storageKey, mimeType: photo.mimeType ?? "application/octet-stream" };
}

// --- Admin verification foundation --------------------------------------

export interface VerifyProfileInput {
  status: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  notes?: string;
}

/** Gated by the existing "profiles.verify" admin permission (seeded in
 * B1 — see src/server/db/seed.ts) — no new authorization code, per B3
 * §17/§21. A normal member-subject ctx is rejected by requirePermission
 * itself (it only ever passes for an admin subject), so a USER can never
 * reach this regardless of what they send. */
export async function verifyProfile(ctx: AuthContext, profileId: string, input: VerifyProfileInput): Promise<OwnerProfileView> {
  await requirePermission(ctx, "profiles.verify");

  const existing = await profilesRepo.findById(profileId);
  if (!existing) throw new NotFoundError("Profile not found.");

  await profilesRepo.update(profileId, {
    verificationStatus: input.status,
    verifiedAt: input.status === "VERIFIED" ? new Date() : null,
    verifiedByAdminId: ctx.subject.id,
  });

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "profile.verification_changed",
    entityType: "profile",
    entityId: profileId,
    metadata: { previousStatus: existing.verificationStatus, newStatus: input.status, notes: input.notes },
  });

  const found = await profilesRepo.findByIdWithAccount(profileId);
  if (!found) throw new NotFoundError("Profile not found.");
  const [lookups, photos] = await Promise.all([resolveLookups(found.profile), profilesRepo.listPhotos(profileId)]);
  return toOwnerProfileView(found.profile, found.displayName, lookups, photos);
}

// --- Reference / lookup options ------------------------------------------

export interface ProfileReferenceOptions {
  religions: LookupRow[];
  motherTongues: LookupRow[];
  educations: LookupRow[];
  professions: LookupRow[];
  maritalStatuses: LookupRow[];
  countries: Array<LookupRow & { isoCode: string | null }>;
  cities?: LookupRow[];
  communities?: LookupRow[];
}

/** Public, unauthenticated reference data (B3 §4/§19) — no PII, needed
 * to populate onboarding/edit forms before a session even exists (e.g.
 * during signup). `countryId`/`religionId` optionally include that
 * country's seeded cities / that religion's seeded communities — the
 * full open-ended sets are still reachable via findOrCreate on write,
 * per reference.repository.ts. */
export async function getProfileReferenceOptions(countryId?: string, religionId?: string): Promise<ProfileReferenceOptions> {
  const [religionsList, motherTonguesList, educationsList, professionsList, maritalStatusesList, countriesList] =
    await Promise.all([
      referenceRepo.listReligions(),
      referenceRepo.listMotherTongues(),
      referenceRepo.listEducations(),
      referenceRepo.listProfessions(),
      referenceRepo.listMaritalStatuses(),
      referenceRepo.listCountries(),
    ]);

  const result: ProfileReferenceOptions = {
    religions: religionsList,
    motherTongues: motherTonguesList,
    educations: educationsList,
    professions: professionsList,
    maritalStatuses: maritalStatusesList,
    countries: countriesList,
  };

  if (countryId) result.cities = await referenceRepo.listCitiesForCountry(countryId);
  if (religionId) result.communities = await referenceRepo.listCommunitiesForReligion(religionId);

  return result;
}
