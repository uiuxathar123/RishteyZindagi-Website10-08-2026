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
