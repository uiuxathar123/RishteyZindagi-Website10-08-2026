/**
 * Response shapes the UI consumes. They mirror the backend DTOs
 * (src/server/modules/**\/*.dto.ts) field-for-field; where the backend
 * returns a value the UI does not use it is simply omitted here.
 */

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LookupRow {
  id: string;
  name: string;
}

// --- reference data ----------------------------------------------------
export interface ReferenceOptions {
  religions: LookupRow[];
  motherTongues: LookupRow[];
  educations: LookupRow[];
  professions: LookupRow[];
  maritalStatuses: LookupRow[];
  countries: Array<LookupRow & { isoCode?: string }>;
  /** Present when `religionId` was supplied. Names are "<sect> › <group>". */
  communities?: LookupRow[];
  /** Present when `countryId` or `countryIso` was supplied. */
  cities?: LookupRow[];
}

// --- account -----------------------------------------------------------
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  mobileNumber: string;
  countryCode: string;
  status: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  country: string | null;
  city: string | null;
  createdAt: string;
}

export interface OtpChallenge {
  identifier: string;
  channel: "SMS" | "WHATSAPP" | "EMAIL";
  expiresInSeconds: number;
  resendAvailableAt: string;
}

/** B18: POST /auth/register. `otpRequired === false` means the platform skips the contact check: no code was sent and `ticket` can go straight to set-password. */
export type RegisterResponse = Omit<OtpChallenge, "channel"> & {
  channel: OtpChallenge["channel"] | "NONE";
  otpRequired?: boolean;
  ticket?: string;
  ticketExpiresAt?: string;
};

export type LoginResponse =
  | { user: PublicUser; expiresAt: string }
  | ({ deviceVerificationRequired: true } & OtpChallenge);

// --- profile -----------------------------------------------------------
export interface OwnerPhoto {
  id: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
  uploadStatus: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  moderation: string;
  createdAt: string;
}

export interface Lifestyle {
  diet?: "VEGETARIAN" | "NON_VEGETARIAN" | "VEGAN" | "EGGETARIAN" | "JAIN";
  smoking?: "NO" | "OCCASIONALLY" | "YES";
  drinking?: "NO" | "OCCASIONALLY" | "YES";
  disability?: string;
}

export interface FamilyDetails {
  familyType?: "NUCLEAR" | "JOINT";
  familyValues?: "TRADITIONAL" | "MODERATE" | "LIBERAL";
  fatherOccupation?: string;
  motherOccupation?: string;
  siblings?: number;
  notes?: string;
}

export interface OwnerProfile {
  id: string;
  /** Member-facing profile ID (RZ + 8 digits). */
  profileId?: string;
  userId: string;
  displayName: string;
  gender: "MALE" | "FEMALE";
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
  incomeMinAmount: number | null;
  incomeMaxAmount: number | null;
  heightCm: number | null;
  country: LookupRow | null;
  city: LookupRow | null;
  aboutMe: string | null;
  lifestyle: Lifestyle | null;
  familyDetails: FamilyDetails | null;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  verifiedAt: string | null;
  /** "Company Verified" — approved by the RishteyZindagi team's own review. */
  companyVerified?: boolean;
  profileCompletionPercent: number;
  missingRequiredFields: string[];
  profileStatus: "INCOMPLETE" | "COMPLETE" | "READY_FOR_VISIBILITY";
  isReadyForVisibility: boolean;
  approvalStatus?: "APPROVED" | "PENDING" | "REJECTED";
  approvalReason?: string | null;
  photos: OwnerPhoto[];
}

export interface ProfileCompletion {
  profileCompletionPercent: number;
  missingRequiredFields: string[];
  profileStatus: OwnerProfile["profileStatus"];
}

export interface PublicPhoto {
  id: string;
  url: string;
  isPrimary: boolean;
}

/** What a signed-in member sees of someone else. */
export interface MemberProfile {
  id: string;
  /** Member-facing profile ID (RZ + 8 digits). */
  profileId?: string;
  /** The owner's user id — what interaction / chat / report APIs address. */
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
  companyVerified?: boolean;
  photos: PublicPhoto[];
  /** B18: true when the owner limited photos to accepted connections and you are not one. */
  photosRestricted?: boolean;
  /** B18: coarse hint such as "Active this week"; absent/null when the owner hides it. */
  lastActive?: string | null;
}

/** What a signed-out visitor sees. No user id, no photo URL. */
export interface GatedProfile {
  id: string;
  displayName: string;
  age: number;
  country: string | null;
  city: string | null;
  education: string | null;
  profession: string | null;
  verificationStatus: string;
  companyVerified?: boolean;
  photoBlurred: boolean;
}

export type SearchItem =
  | { audience: "authenticated"; profile: MemberProfile }
  | { audience: "anonymous"; profile: GatedProfile };

export interface CompatibilityBreakdownRow {
  category: string;
  result: string;
  weight: number;
  contribution: number;
}

/** Real shape (recommendations.dto.ts): the profile is NESTED, not flattened. */
export interface RecommendationItem {
  profile: MemberProfile;
  compatibilityScore: number;
  compatibilityBreakdown: CompatibilityBreakdownRow[];
  tier: "PRIMARY" | "SECONDARY";
}

export interface RecommendationsPage extends Page<RecommendationItem> {
  status: "ok" | "preferences_not_configured";
  secondaryItems: RecommendationItem[];
  secondaryTotal: number;
}

export interface PartnerPreferences {
  ageMin: number | null;
  ageMax: number | null;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  genderPreference: "MALE" | "FEMALE" | null;
  religion: LookupRow | null;
  maritalStatusIds: string[];
  communityIds: string[];
  motherTongueIds: string[];
  educationIds: string[];
  professionIds: string[];
  professionAny: boolean;
  countryIds: string[];
  cityIds: string[];
  incomeMinAmount: number | null;
  incomeMaxAmount: number | null;
  incomeCurrency: string | null;
  notes: string | null;
}

// --- interactions ------------------------------------------------------
export interface CounterpartRef {
  userId: string;
  name: string | null;
  profileId: string | null;
}

export type InterestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

export interface InterestView {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: InterestStatus;
  createdAt: string;
  respondedAt: string | null;
  counterpart: CounterpartRef;
}

export interface LikeView {
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface ShortlistView {
  id: string;
  userId?: string;
  targetUserId: string;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface BlockView {
  id: string;
  blockedUserId: string;
  reason: string | null;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface MatchView {
  id: string;
  matchedAt: string;
  counterpart: CounterpartRef;
}

// --- chat ----------------------------------------------------------------
export interface ChatSummary {
  id: string;
  matchId: string;
  createdAt: string;
  lastMessageAt: string | null;
  counterpart: CounterpartRef;
  unreadCount: number;
}

export interface MessageView {
  id: string;
  chatId: string;
  senderUserId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  mine: boolean;
}

// --- notifications -------------------------------------------------------
export interface NotificationView {
  id: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" | "IN_APP";
  title: string;
  body: string;
  isRead: boolean;
  readAt: string | null;
  deliveryStatus: string;
  createdAt: string;
}

// --- membership / payments ------------------------------------------------
export interface MembershipPlan {
  id: string;
  code: string;
  name: string;
  priceInSmallestUnit: number;
  currency: "INR" | "USD" | string;
  durationDays: number;
  features: Record<string, boolean>;
}

export interface MembershipView {
  id: string;
  planId: string;
  status: "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  startedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  createdAt: string;
}

export interface MyMembership {
  membership: MembershipView | null;
  planCode: string | null;
  planName: string | null;
  isActive: boolean;
  /** B18: what the current plan unlocks (advanced search filters). */
  entitlements?: { advancedSearch: boolean };
  /** Interests and chat included with Personal Matchmaking (not a plan), while running. */
  includedAccess?: { until: string } | null;
}

export interface CheckoutResult {
  paymentId: string;
  membershipId: string;
  transactionRef: string;
  providerOrderId: string | null;
  amountInPaise: number;
  currency: string;
  gatewayName: string;
  status: "PENDING";
  /** Present for real gateways: public data the browser needs to finish paying (never a secret). */
  gatewayCheckout?: import("./pcp-types").ClientCheckoutData;
}

export interface PaymentView {
  id: string;
  membershipId: string | null;
  /** Set when the payment is for Personal Matchmaking instead of a membership. */
  matchmakingCaseId?: string | null;
  gatewayId: string;
  amountInPaise: number;
  currency: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  gatewayReference: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerifyPaymentResult {
  payment: PaymentView;
  status: "SUCCESS" | "FAILED" | "PENDING" | "ALREADY_RESOLVED";
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  amountInPaise: number;
  status: "ISSUED" | "PAID" | "VOID";
  issuedAt: string;
  cancelledAt: string | null;
}

// --- safety ---------------------------------------------------------------
export interface ReportCategory {
  id: string;
  name: string;
  description: string | null;
  isActive?: boolean;
}

export interface WarningView {
  id: string;
  categoryId: string;
  status: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

// --- admin -----------------------------------------------------------------
export interface AdminIdentity {
  admin: { id: string; name: string; email: string; role: "SUPER_ADMIN" | "STAFF_ADMIN" | string; mustChangePassword?: boolean };
  permissions: string[];
}

export interface AdminDashboardStats {
  stats: {
    users: { total: number; active: number; suspended: number };
    profiles: { readyForVisibility: number; pendingVerification: number };
    memberships: { active: number; expiringSoon: number; expiringSoonWindowDays: number };
    payments: {
      total: number;
      successful: number;
      failed: number;
      pending: number;
      revenueByCurrency: Array<{ currency: string; totalInSmallestUnit?: number; amountInPaise?: number; total?: number }>;
    };
    reports: { open: number };
    suspensions: { activeAfterThreshold: number };
  };
}

export interface AdminUserSummary {
  id: string;
  /** Member-facing profile ID (RZ + 8 digits); null until a profile exists. */
  profileId?: string | null;
  name: string;
  email: string;
  mobileNumber: string;
  countryCode: string;
  status: string;
  country: string | null;
  city: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  profileStatus: string | null;
  verificationStatus: string | null;
  hasProfilePhoto: boolean | null;
  /** Backend photo path of the primary photo; use photoSrc(url, "admin"). */
  primaryPhotoUrl?: string | null;
}

export interface AdminUserDetail {
  account: {
    id: string;
    name: string;
    email: string;
    mobileNumber: string;
    countryCode: string;
    status: string;
    emailVerifiedAt: string | null;
    mobileVerifiedAt: string | null;
    country: string | null;
    city: string | null;
    lastActiveAt: string | null;
    createdAt: string;
  };
  profile: {
    id: string;
    gender: string;
    profileStatus: string;
    verificationStatus: string;
    verifiedAt: string | null;
    profileCompletionPercent: number;
    hasProfilePhoto: boolean;
  } | null;
  memberships: MembershipView[];
  reports: { againstCount: number; filedCount: number };
  warnings: WarningView[];
  suspensions: Array<{ id: string; suspendedAt: string; liftedAt: string | null; reason: string | null }>;
  auditHistory: Array<{ id: string; action: string; actorRole: string | null; createdAt: string }>;
}

export interface OtpConfig {
  activeMethod: "SMS" | "WHATSAPP" | "EMAIL";
  enabled: boolean;
  otpLength: number;
  otpExpirySeconds: number;
  maxVerifyAttempts: number;
  resendCooldownSeconds: number;
  maxResendAttempts: number;
  resendWindowSeconds: number;
  devMode: boolean;
  providers: { sms: boolean; whatsapp: boolean; email: boolean };
  updatedAt: string;
}

export interface MatchingWeights {
  weights: Record<string, number>;
  updatedAt: string;
  updatedByAdminId: string | null;
}

export interface PaymentGatewayView {
  id: string;
  name: string;
  isActive: boolean;
  mode: string | null;
  merchantIdLast4: string | null;
  credentialsConfigured: boolean;
  envConfigured: boolean;
}

export interface AuditLogEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata: unknown;
}

export interface AdminReport {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  categoryId: string;
  status: string;
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type OtpPurpose = "SIGNUP" | "LOGIN" | "FORGOT_PASSWORD" | "NEW_DEVICE" | "ACCOUNT_RECOVERY" | "ADMIN_MFA" | "CONTACT_CHANGE";

// --- discovery / interactions (agent C) ------------------------------------
/** GET /profiles/:profileId — the backend picks the shape by who is asking. */
export type ProfileViewResponse =
  | { audience: "owner" | "admin"; profile: OwnerProfile }
  | { audience: "authenticated"; profile: MemberProfile }
  | { audience: "anonymous"; profile: GatedProfile };

/** GET /profiles/summaries — batched card data; an id maps to null when that profile is not visible to the viewer. */
export interface ProfileSummariesResponse {
  items: Record<string, Extract<ProfileViewResponse, { audience: "authenticated" }> | null>;
}

/** Result of POST /interactions/interests. */
export interface SendInterestResult {
  interest: InterestView;
  matched: boolean;
}

// --- membership checkout / invoices (agent D, B16b) ------------------------
export interface InvoiceDetail extends InvoiceSummary {
  paymentId: string | null;
  cancellationReason: string | null;
  snapshot: unknown;
}
