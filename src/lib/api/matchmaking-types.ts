/** Client-side shapes of the Personal Matchmaking API (see src/server/modules/matchmaking). */

export type MatchmakingCaseStatus = "PENDING_PAYMENT" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "REFUNDED";
export type SuggestionStatus = "PROPOSED" | "APPROVED" | "SENT" | "WITHDRAWN";
export type SuggestionResponse = "PENDING" | "INTERESTED" | "NOT_INTERESTED";

export interface MatchmakingOffer {
  available: boolean;
  currency: string;
  priceInSmallestUnit: number | null;
  includedMembershipDays: number;
  consentVersion: string;
  consentText: string;
}

export interface MatchmakingCheckout {
  paymentId: string;
  caseId: string;
  amountInPaise: number;
  currency: string;
  gatewayName: string;
  status: "PENDING";
  gatewayCheckout?:
    | { provider: "RAZORPAY"; keyId: string; orderId: string; amount: number; currency: string }
    | { provider: "PHONEPE"; redirectUrl: string };
}

/** The member-facing public profile view (no contact details), as returned by the API. */
export interface SuggestedProfile {
  id: string;
  profileId: string;
  userId: string;
  displayName: string;
  age: number | null;
  gender: "MALE" | "FEMALE";
  religion: string | null;
  community: string | null;
  motherTongue: string | null;
  education: string | null;
  profession: string | null;
  city?: string | null;
  country?: string | null;
  [key: string]: unknown;
}

export interface MemberMatchmakingCase {
  id: string;
  status: MatchmakingCaseStatus;
  priceInSmallestUnit: number;
  currency: string;
  includedMembershipDays: number;
  includedAccessUntil: string | null;
  accessRevoked: boolean;
  complimentary: boolean;
  paidAt: string | null;
  closedAt: string | null;
  customerNotes: string | null;
  createdAt: string;
}

export interface MemberSuggestion {
  id: string;
  sentAt: string | null;
  response: SuggestionResponse;
  respondedAt: string | null;
  profile: SuggestedProfile;
}

export interface MyMatchmaking {
  offer: MatchmakingOffer;
  optOut: boolean;
  case: MemberMatchmakingCase | null;
  invitation: MemberInvitation | null;
  history: Array<{ id: string; kind: string; toStatus: string | null; note: string | null; createdAt: string }>;
  suggestions: MemberSuggestion[];
}

export interface MatchmakingSettings {
  enabled: boolean;
  prices: { INR: number | null; USD: number | null };
  includedMembershipDays: number;
}

export interface AdminCaseListItem {
  id: string;
  status: MatchmakingCaseStatus;
  customer: { userId: string; name: string; email: string };
  priceInSmallestUnit: number;
  /** A free case from a Super Admin invitation (no payment). */
  complimentary: boolean;
  currency: string;
  paidAt: string | null;
  includedAccessUntil: string | null;
  suggestionsSent: number;
  suggestionsTotal: number;
  /** Captured payments beyond the one that paid for the case — the member was charged twice and needs a refund. */
  duplicateCaptures: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreBreakdownEntry {
  category: string;
  result: string;
  weight: number;
  contribution: number;
}

export interface AdminCaseEvent {
  id: string;
  actorType: "ADMIN" | "USER" | "SYSTEM";
  kind: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  customerVisible: boolean;
  createdAt: string;
}

export interface AdminSuggestion {
  id: string;
  candidateUserId: string;
  source: "AUTO" | "MANUAL";
  score: number | null;
  scoreBreakdown: ScoreBreakdownEntry[] | null;
  status: SuggestionStatus;
  response: SuggestionResponse;
  respondedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  candidateEligibleNow: boolean;
  candidate: SuggestedProfile | null;
}

export interface AdminCaseDetail {
  case: {
    id: string;
    userId: string;
    status: MatchmakingCaseStatus;
    priceInPaise: number;
    currency: string;
    includedMembershipDays: number;
    customerNotes: string | null;
    consentedAt: string;
    consentVersion: string;
    paidAt: string | null;
    includedAccessUntil: string | null;
    includedAccessRevokedAt: string | null;
    complimentary: boolean;
    closedAt: string | null;
    createdAt: string;
  };
  customer: { id: string; name: string; email: string; status: string } | null;
  customerProfile: { profileId: string; gender: string; hasPreferences: boolean; profileStatus: string } | null;
  events: AdminCaseEvent[];
  payments: AdminCasePayment[];
  duplicateCaptures: number;
  suggestions: AdminSuggestion[];
}

export interface AdminCasePayment {
  id: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  amountInPaise: number;
  currency: string;
  gatewayReference: string | null;
  verifiedAt: string | null;
  createdAt: string;
  isPaidPayment: boolean;
  duplicateCapture: boolean;
}

export interface AdminRecommendation {
  candidateUserId: string;
  score: number;
  tier: "PRIMARY" | "SECONDARY" | null;
  breakdown: ScoreBreakdownEntry[];
  candidate: SuggestedProfile;
}

export const CASE_STATUS_LABEL: Record<MatchmakingCaseStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  ACTIVE: "Active",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

// --- Super Admin introductions and Company Verified -------------------------------------------------

export type IntroductionStatus = "PENDING" | "MUTUALLY_ACCEPTED" | "DECLINED" | "WITHDRAWN";
export type IntroductionMemberResponse = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
export type CompanyVerificationStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";

export const INTRODUCTION_STATUS_LABEL: Record<IntroductionStatus, string> = {
  PENDING: "Waiting for answers",
  MUTUALLY_ACCEPTED: "Both accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
};

export const INTRODUCTION_RESPONSE_LABEL: Record<IntroductionMemberResponse, string> = {
  PENDING: "No answer yet",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrew",
};

export const COMPANY_VERIFICATION_LABEL: Record<CompanyVerificationStatus, string> = {
  NONE: "Not reviewed",
  PENDING: "Review open",
  APPROVED: "Company Verified",
  REJECTED: "Rejected",
  REVOKED: "Revoked",
};

export interface AdminMemberSummary {
  userId: string;
  name: string;
  email: string;
  profileId: string;
  gender: "MALE" | "FEMALE";
  age: number;
  accountStatus: string;
  profileStatus: string;
  approvalStatus: string;
  profileVisibility: string;
  profileCompletionPercent: number;
  matchmakingOptOut: boolean;
  companyVerificationStatus: CompanyVerificationStatus;
  blocksMade: number;
  blocksReceived: number;
  introducible: boolean;
  problems: string[];
}

export interface IntroductionCompatibility {
  score: number;
  breakdown: ScoreBreakdownEntry[];
}

export interface IntroductionPreview {
  eligible: boolean;
  problems: string[];
  members: { a: AdminMemberSummary; b: AdminMemberSummary };
  blocks: { aBlockedB: boolean; bBlockedA: boolean };
  alreadyMatched: boolean;
  openIntroductionId: string | null;
  compatibility: { aToB: IntroductionCompatibility | null; bToA: IntroductionCompatibility | null };
}

export interface AdminIntroduction {
  id: string;
  status: IntroductionStatus;
  userA: { userId: string; name: string; response: IntroductionMemberResponse; respondedAt: string | null };
  userB: { userId: string; name: string; response: IntroductionMemberResponse; respondedAt: string | null };
  scoreAToB: number | null;
  scoreBToA: number | null;
  messageToMembers: string | null;
  internalNote: string | null;
  createdByAdminId: string;
  withdrawnByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface MemberIntroduction {
  id: string;
  status: "PENDING" | "MUTUALLY_ACCEPTED";
  myResponse: IntroductionMemberResponse;
  myRespondedAt: string | null;
  messageFromTeam: string | null;
  createdAt: string;
  profile: SuggestedProfile;
}

export interface CompanyVerificationView {
  userId: string;
  profileId: string;
  status: CompanyVerificationStatus;
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  history: Array<{ id: string; from: string | null; to: string | null; note: string | null; reviewer: { id: string; name: string } | null; createdAt: string }>;
}

export interface MatchmakingOverview {
  cases: { PENDING_PAYMENT: number; ACTIVE: number; IN_PROGRESS: number };
  duplicateCaptures: number;
  introductions: { PENDING: number; MUTUALLY_ACCEPTED: number };
  verificationReviewsOpen: number;
}

export interface IntroductionCandidate {
  member: AdminMemberSummary;
  score: number | null;
  tier: "PRIMARY" | "SECONDARY" | null;
}

export interface IntroductionCandidates {
  member: AdminMemberSummary;
  hasPreferences: boolean;
  items: IntroductionCandidate[];
}

// --- invitations and the members directory ------------------------------------------------------------

export type InvitationKind = "OFFER" | "COMPLIMENTARY";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "Waiting for member",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REVOKED: "Revoked",
};

export interface MemberInvitation {
  id: string;
  kind: InvitationKind;
  messageFromTeam: string | null;
  includedMembershipDays: number | null;
  consentVersion: string;
  consentText: string;
  createdAt: string;
}

export interface AdminInvitation {
  id: string;
  kind: InvitationKind;
  status: InvitationStatus;
  member: { userId: string; name: string; email: string };
  messageToMember: string | null;
  includedMembershipDays: number | null;
  invitedByAdminId: string;
  revokedByAdminId: string | null;
  caseId: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export type DirectoryFilter = "all" | "introducible" | "in_matchmaking" | "no_profile";

export interface DirectoryMember {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  joinedAt: string;
  profile: {
    profileId: string;
    gender: "MALE" | "FEMALE";
    age: number;
    profileStatus: string;
    approvalStatus: string;
    profileVisibility: string;
    profileCompletionPercent: number;
    matchmakingOptOut: boolean;
    companyVerificationStatus: CompanyVerificationStatus;
  } | null;
  blocksMade: number;
  blocksReceived: number;
  matchmaking: { openCaseStatus: MatchmakingCaseStatus | null; complimentary: boolean; pendingInvitationKind: InvitationKind | null };
  introducible: boolean;
  introductionProblems: string[];
  invitable: boolean;
  invitationProblems: string[];
}
