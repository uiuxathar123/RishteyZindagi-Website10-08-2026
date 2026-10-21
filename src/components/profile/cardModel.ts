/**
 * A single, flat shape the profile card and the member page render from.
 * It is built ONLY from fields the API actually returned (search item,
 * recommendation item, or GET /profiles/:id) — nothing is invented, and an
 * absent field stays absent so the UI can simply not show it.
 */
import { photoSrc, primaryPhotoUrl } from "@/lib/photo";
import { defaultAvatarSrc } from "@/lib/avatar/defaultAvatar";
import type {
  CompatibilityBreakdownRow,
  GatedProfile,
  MemberProfile,
  ProfileViewResponse,
  RecommendationItem,
  SearchItem,
} from "@/lib/api/types";

export interface CardProfile {
  profileId: string;
  /** Member-facing ID (RZ + 8 digits) — only in the signed-in view. */
  publicId?: string;
  /** Present only when the API showed us the full (signed-in) view. Needed for like / interest / shortlist / chat / block / report. */
  userId?: string;
  audience: "authenticated" | "anonymous";
  displayName: string;
  age: number;
  city: string | null;
  country: string | null;
  education: string | null;
  profession: string | null;
  religion?: string | null;
  community?: string | null;
  motherTongue?: string | null;
  maritalStatus?: string | null;
  gender?: string | null;
  heightCm?: number | null;
  incomeRange?: string | null;
  aboutMe?: string | null;
  verified: boolean;
  /** "Company Verified" — shown only when the API says the team's review was approved. */
  companyVerified: boolean;
  /** Proxied (`/bff/...`) src of the primary photo, if the API gave one. */
  photoSrc?: string;
  /** All photos (proxied), primary first. */
  photos: Array<{ id: string; src: string; isPrimary: boolean }>;
  /** Anonymous view: a photo exists but the API withheld it. */
  photoWithheld?: boolean;
  /** Signed-in view: the owner limited photos to accepted connections. */
  photosRestricted?: boolean;
  /** Coarse activity hint ("Active this week"), only when the owner allows it. */
  lastActive?: string | null;
  /** Only when the API supplied a compatibility result. */
  score?: number;
  breakdown?: CompatibilityBreakdownRow[];
  tier?: "PRIMARY" | "SECONDARY";
}

function fromMember(p: MemberProfile): CardProfile {
  const sorted = [...p.photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return {
    profileId: p.id,
    publicId: p.profileId,
    userId: p.userId,
    audience: "authenticated",
    displayName: p.displayName,
    age: p.age,
    city: p.city,
    country: p.country,
    education: p.education,
    profession: p.profession,
    religion: p.religion,
    community: p.community,
    motherTongue: p.motherTongue,
    maritalStatus: p.maritalStatus,
    gender: p.gender,
    heightCm: p.heightCm,
    incomeRange: p.incomeRange,
    aboutMe: p.aboutMe,
    verified: p.verificationStatus === "VERIFIED",
    companyVerified: p.companyVerified === true,
    photoSrc: photoSrc(primaryPhotoUrl(p.photos)),
    photos: sorted.map((ph) => ({ id: ph.id, src: photoSrc(ph.url) as string, isPrimary: ph.isPrimary })),
    photosRestricted: p.photosRestricted === true,
    lastActive: p.lastActive ?? null,
  };
}

function fromGated(p: GatedProfile): CardProfile {
  return {
    profileId: p.id,
    audience: "anonymous",
    displayName: p.displayName,
    age: p.age,
    city: p.city,
    country: p.country,
    education: p.education,
    profession: p.profession,
    verified: p.verificationStatus === "VERIFIED",
    companyVerified: p.companyVerified === true,
    photos: [],
    photoWithheld: p.photoBlurred,
  };
}

export function fromSearchItem(item: SearchItem): CardProfile {
  return item.audience === "authenticated" ? fromMember(item.profile) : fromGated(item.profile);
}

export function fromRecommendation(item: RecommendationItem): CardProfile {
  return {
    ...fromMember(item.profile),
    score: item.compatibilityScore,
    breakdown: item.compatibilityBreakdown,
    tier: item.tier,
  };
}

/** GET /profiles/:id. Owner / admin shapes are not a "card" — callers branch on `audience` first. */
export function fromProfileView(view: ProfileViewResponse): CardProfile | null {
  if (view.audience === "authenticated") return fromMember(view.profile);
  if (view.audience === "anonymous") return fromGated(view.profile);
  return null;
}

/** The member's default avatar (gender + religion), shown when there is no photo; undefined for the anonymous view. */
export function cardAvatar(p: Pick<CardProfile, "gender" | "religion" | "profileId">): string | undefined {
  return defaultAvatarSrc({ gender: p.gender, religion: p.religion, seed: p.profileId });
}

export function locationLine(p: Pick<CardProfile, "city" | "country">): string {
  return [p.city, p.country].filter(Boolean).join(", ");
}
