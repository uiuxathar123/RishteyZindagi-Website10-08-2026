/** Response shapes for the B18 OTP policy endpoints. */

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
export interface SecurityEventRow {
  id: string;
  source: "LOGIN_ATTEMPT" | "AUDIT";
  occurredAt: string;
  kind: string;
  actorType: "USER" | "ADMIN" | "SYSTEM" | "UNKNOWN";
  subject: string | null;
  ipAddress: string | null;
  detail: string | null;
}
