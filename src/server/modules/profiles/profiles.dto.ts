/**
 * B3: shapes profile data for the three distinct audiences the brief
 * requires (§9/§10/§11) — owner, authenticated non-owner viewer, and
 * anonymous visitor — so the data boundary is enforced once, here, rather
 * than trusted to whatever a route handler happens to select. Nothing
 * outside this file should hand-assemble a profile response object.
 */
import type { ProfileRow, ProfilePhotoRow } from "./profiles.repository";
import type { LookupRow } from "./reference.repository";
import { computeAge, computeCompletion, type ProfileStatus } from "./completion";

/** "Company Verified" (a Super Admin review, see matchmaking/company-verification.service.ts): only APPROVED counts. */
const companyVerified = (profile: ProfileRow): boolean => profile.companyVerificationStatus === "APPROVED";

export interface ResolvedLookups {
  maritalStatus: LookupRow | null;
  religion: LookupRow | null;
  community: LookupRow | null;
  motherTongue: LookupRow | null;
  education: LookupRow | null;
  profession: LookupRow | null;
  country: LookupRow | null;
  city: LookupRow | null;
}

function gatedPhotoUrl(photoId: string): string {
  // Always the backend-controlled delivery route (see
  // src/app/api/v1/profiles/photos/[photoId]/file/route.ts) — never a raw
  // storage-provider URL. See BACKEND.md's B3 "photo access security"
  // note for why.
  return `/api/v1/profiles/photos/${photoId}/file`;
}

export interface OwnerPhotoView {
  id: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
  uploadStatus: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  moderation: string;
  createdAt: string;
}

export function toOwnerPhotoView(photo: ProfilePhotoRow): OwnerPhotoView {
  return {
    id: photo.id,
    url: gatedPhotoUrl(photo.id),
    isPrimary: photo.isPrimary,
    sortOrder: photo.sortOrder,
    uploadStatus: photo.uploadStatus,
    mimeType: photo.mimeType,
    fileSizeBytes: photo.fileSizeBytes,
    width: photo.width,
    height: photo.height,
    moderation: photo.moderation,
    createdAt: photo.createdAt.toISOString(),
  };
}

export interface OwnerProfileView {
  id: string;
  /** B18: the member-facing profile ID (RZ + 8 digits) — shareable, searchable, never a database key. */
  profileId: string;
  userId: string;
  displayName: string;
  gender: string;
  dateOfBirth: string;
  age: number;
  maritalStatus: LookupRow | null;
  religion: LookupRow | null;
  community: LookupRow | null;
  motherTongue: LookupRow | null;
  motherTongueIds: string[];
  education: LookupRow | null;
  educationIds: string[];
  profession: LookupRow | null;
  professionIds: string[];
  incomeRange: string | null;
  incomeCurrency: string | null;
  // B4: structured numeric counterparts to incomeRange — see schema.ts's
  // comment on profiles.incomeMinAmount.
  incomeMinAmount: number | null;
  incomeMaxAmount: number | null;
  heightCm: number | null;
  country: LookupRow | null;
  city: LookupRow | null;
  aboutMe: string | null;
  lifestyle: unknown;
  familyDetails: unknown;
  verificationStatus: string;
  verifiedAt: string | null;
  companyVerified: boolean;
  profileCompletionPercent: number;
  missingRequiredFields: string[];
  profileStatus: ProfileStatus;
  isReadyForVisibility: boolean;
  approvalStatus: string;
  approvalReason: string | null;
  photos: OwnerPhotoView[];
  createdAt: string;
  updatedAt: string;
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function toOwnerProfileView(
  profile: ProfileRow,
  displayName: string,
  lookups: ResolvedLookups,
  photos: ProfilePhotoRow[]
): OwnerProfileView {
  const hasProfilePhoto = photos.length > 0;
  const completion = computeCompletion(profile, hasProfilePhoto);

  return {
    id: profile.id,
    profileId: profile.publicId,
    userId: profile.userId,
    displayName,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth.toISOString(),
    age: computeAge(profile.dateOfBirth),
    maritalStatus: lookups.maritalStatus,
    religion: lookups.religion,
    community: lookups.community,
    motherTongue: lookups.motherTongue,
    motherTongueIds: asIdArray(profile.motherTongueIds),
    education: lookups.education,
    educationIds: asIdArray(profile.educationIds),
    profession: lookups.profession,
    professionIds: asIdArray(profile.professionIds),
    incomeRange: profile.incomeRange,
    incomeCurrency: profile.incomeCurrency,
    incomeMinAmount: profile.incomeMinAmount,
    incomeMaxAmount: profile.incomeMaxAmount,
    heightCm: profile.heightCm,
    country: lookups.country,
    city: lookups.city,
    aboutMe: profile.aboutMe,
    lifestyle: profile.lifestyle ?? null,
    familyDetails: profile.familyDetails ?? null,
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt ? profile.verifiedAt.toISOString() : null,
    companyVerified: companyVerified(profile),
    profileCompletionPercent: completion.profileCompletionPercent,
    missingRequiredFields: completion.missingRequiredFields,
    profileStatus: completion.profileStatus,
    isReadyForVisibility: completion.profileStatus === "READY_FOR_VISIBILITY",
    // B19: manual-approval state (PENDING = waiting for an admin, REJECTED = hidden; the reason is shown to the owner only).
    approvalStatus: profile.approvalStatus,
    approvalReason: profile.approvalStatus === "REJECTED" ? profile.approvalReason ?? null : null,
    photos: photos.map(toOwnerPhotoView),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export interface AuthenticatedPublicPhotoView {
  id: string;
  url: string;
  isPrimary: boolean;
}

export interface AuthenticatedPublicProfileView {
  id: string;
  /** B18: member-facing profile ID (RZ + 8 digits). Not part of the anonymous gated view. */
  profileId: string;
  /** B16: the owning member's user id. Every interaction/chat/report API
   * addresses a *user*, while this view is addressed by *profile* id, so
   * without this field an authenticated client has no way to act on a
   * profile it is looking at. Deliberately absent from the anonymous
   * gated view below — a signed-out visitor never receives it. */
  userId: string;
  displayName: string;
  age: number;
  gender: string;
  maritalStatus: string | null;
  religion: string | null;
  community: string | null;
  motherTongue: string | null;
  education: string | null;
  profession: string | null;
  incomeRange: string | null;
  heightCm: number | null;
  country: string | null;
  city: string | null;
  aboutMe: string | null;
  verificationStatus: string;
  companyVerified: boolean;
  photos: AuthenticatedPublicPhotoView[];
  /** B18: true when the owner limited photos to accepted connections and the viewer is not one. */
  photosRestricted: boolean;
  /** B18: coarse activity label ("Active this week"); null when the owner hides it or it is unknown. */
  lastActive: string | null;
}

/** Full non-owner authenticated view — never includes email, mobile,
 * exact account/session data, or any admin-only field. See B3 §11. */
export function toAuthenticatedPublicView(
  profile: ProfileRow,
  displayName: string,
  lookups: ResolvedLookups,
  photos: ProfilePhotoRow[],
  /** B18 (see privacy.ts). Fail-closed: omitted extras mean photos are withheld when the owner restricted them. */
  extras?: { photosVisible?: boolean; lastActive?: string | null }
): AuthenticatedPublicProfileView {
  const photosRestricted = profile.photoVisibility === "ACCEPTED_ONLY" && extras?.photosVisible !== true;
  return {
    id: profile.id,
    profileId: profile.publicId,
    userId: profile.userId,
    displayName,
    age: computeAge(profile.dateOfBirth),
    gender: profile.gender,
    maritalStatus: lookups.maritalStatus?.name ?? null,
    religion: lookups.religion?.name ?? null,
    community: lookups.community?.name ?? null,
    motherTongue: lookups.motherTongue?.name ?? null,
    education: lookups.education?.name ?? null,
    profession: lookups.profession?.name ?? null,
    incomeRange: profile.incomeRange,
    heightCm: profile.heightCm,
    country: lookups.country?.name ?? null,
    city: lookups.city?.name ?? null,
    aboutMe: profile.aboutMe,
    verificationStatus: profile.verificationStatus,
    companyVerified: companyVerified(profile),
    photos: photosRestricted ? [] : photos.map((p) => ({ id: p.id, url: gatedPhotoUrl(p.id), isPrimary: p.isPrimary })),
    photosRestricted,
    lastActive: profile.showLastActive ? extras?.lastActive ?? null : null,
  };
}

export interface AnonymousGatedProfileView {
  id: string;
  displayName: "Member Profile";
  age: number;
  country: string | null;
  city: string | null;
  education: string | null;
  profession: string | null;
  verificationStatus: string;
  companyVerified: boolean;
  photoBlurred: boolean;
}

/** B3 §10: the anonymous/public data boundary. Deliberately narrow —
 * anything not explicitly listed in the brief's "Anonymous public
 * profile data" section is left out on purpose, not by omission. No
 * photo URL is ever included here, gated or otherwise. */
export function toAnonymousGatedView(
  profile: ProfileRow,
  lookups: ResolvedLookups,
  hasPhoto: boolean
): AnonymousGatedProfileView {
  return {
    id: profile.id,
    displayName: "Member Profile",
    age: computeAge(profile.dateOfBirth),
    country: lookups.country?.name ?? null,
    city: lookups.city?.name ?? null,
    education: lookups.education?.name ?? null,
    profession: lookups.profession?.name ?? null,
    verificationStatus: profile.verificationStatus,
    companyVerified: companyVerified(profile),
    photoBlurred: hasPhoto,
  };
}
