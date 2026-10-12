/** Response shapes of the B18 endpoints (OTP policy, platform settings, plans, communities, security events, privacy, sessions). */

export type OtpPolicyWorkflow = "NEW_DEVICE_LOGIN" | "SIGNUP_VERIFICATION";
export type OtpRequirement = "OTP_REQUIRED" | "OTP_NOT_REQUIRED";

export interface OtpPolicyView {
  policy: Record<OtpPolicyWorkflow, OtpRequirement>;
  isDefault: boolean;
  updatedAt: string | null;
  updatedByAdminId: string | null;
  workflows: Array<{ key: OtpPolicyWorkflow; label: string; description: string; whenNotRequired: string; requirement: OtpRequirement }>;
  neverConfigurable: Array<{ key: string; label: string; reason: string }>;
  delivery: { channel: string; ready: boolean; devMode: boolean; missing: string[] };
}

export interface PlatformSettingsView {
  search: { defaultPageSize: number; maxPageSize: number; enforceAdvancedSearchEntitlement: boolean };
  signup: { open: boolean; closedMessage: string };
  updatedAt: { search: string | null; signup: string | null };
}

export interface AdminPlanRow {
  id: string;
  code: string;
  name: string;
  currency: string;
  priceInSmallestUnit: number;
  durationDays: number;
  isActive: boolean;
  features: { chat: boolean; advancedSearch: boolean; visibilityBoost: boolean };
  activeMembers: number;
  createdAt: string;
}

export interface AdminCommunityRow {
  id: string;
  name: string;
  religionId: string | null;
  religionName: string | null;
  isActive: boolean;
  profileCount: number;
  createdAt: string;
}

export interface SecurityEventRow {
  id: string;
  source: "LOGIN_ATTEMPT" | "AUDIT";
  occurredAt: string;
  kind: string;
  actorType: "USER" | "ADMIN" | "SYSTEM" | "UNKNOWN";
  /** Masked login identifier (login attempts) or the acting account's id (audit rows). */
  subject: string | null;
  ipAddress: string | null;
  detail: string | null;
}

export interface PrivacySettings {
  profileVisibility: "VISIBLE" | "HIDDEN";
  photoVisibility: "MEMBERS" | "ACCEPTED_ONLY";
  showLastActive: boolean;
}

export interface NotificationPreferences {
  EMAIL: boolean;
  PUSH: boolean;
  WHATSAPP: boolean;
  DIGEST: boolean;
}

export interface MemberSessionRow {
  id: string;
  deviceId: string | null;
  browserInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}
