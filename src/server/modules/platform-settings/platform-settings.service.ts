/** B18: typed, validated, audited OTP policy for configurable workflows. A missing or unreadable setting safely keeps OTP required; provider selection is stored separately. */
import { z } from "zod";
import { AuthorizationError, ValidationError } from "@/server/lib/errors";
import { getOtpDeliveryReadiness, type OtpDeliveryReadiness } from "@/server/modules/otp/otp.service";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireAdminRole, requirePermission } from "@/server/middleware/rbac";
import * as repo from "./platform-settings.repository";

// ---------------------------------------------------------------------------
// OTP policy
// ---------------------------------------------------------------------------

/**
 * Workflows a Super Admin may switch between OTP_REQUIRED and OTP_NOT_REQUIRED.
 * Deliberately a short allow-list. NEVER eligible (always require their existing proof, not configurable):
 * password reset, account recovery, OTP-only login (the OTP *is* the login), admin sign-in, payments.
 */
export const OTP_POLICY_WORKFLOWS = ["NEW_DEVICE_LOGIN", "SIGNUP_VERIFICATION"] as const;
export type OtpPolicyWorkflow = (typeof OTP_POLICY_WORKFLOWS)[number];
export type OtpRequirement = "OTP_REQUIRED" | "OTP_NOT_REQUIRED";
export type OtpPolicy = Record<OtpPolicyWorkflow, OtpRequirement>;

export const OTP_POLICY_DEFAULT: OtpPolicy = { NEW_DEVICE_LOGIN: "OTP_REQUIRED", SIGNUP_VERIFICATION: "OTP_REQUIRED" };

export const OTP_WORKFLOW_INFO: Record<OtpPolicyWorkflow, { label: string; description: string; whenNotRequired: string }> = {
  NEW_DEVICE_LOGIN: {
    label: "New-device login verification",
    description: "The extra code asked for when a member signs in with the correct password from a device we have not seen before.",
    whenNotRequired: "The password is still required. Members signing in from a new device get a session without the extra code; the event is recorded in the audit log.",
  },
  SIGNUP_VERIFICATION: {
    label: "Registration OTP verification",
    description: "ON: a new member must enter the one-time code sent to their e-mail (or mobile, if SMS is the active channel) before the account is created. OFF: new accounts are created without any code and nothing is sent.",
    whenNotRequired: "New accounts are created with the e-mail and mobile number marked UNVERIFIED. Anyone can register an address they do not own, so only switch this off if you accept that.",
  },
};

export const NON_CONFIGURABLE_OTP_WORKFLOWS = [
  { key: "PASSWORD_RESET", label: "Password reset", reason: "A code is the only proof the requester owns the mailbox; skipping it would allow account takeover." },
  { key: "ACCOUNT_RECOVERY", label: "Account recovery after deletion", reason: "Restores a deleted account; always needs the password and a one-time code." },
  { key: "OTP_LOGIN", label: "OTP-only sign-in", reason: "The code is the credential for this sign-in method." },
  { key: "ADMIN_LOGIN", label: "Super Admin / Staff Admin sign-in", reason: "Admin sign-in always needs the password. The optional e-mail code (admin MFA, under Admin security) can only be switched ON here, never used to skip the password." },
  { key: "CONTACT_CHANGE", label: "Changing e-mail or mobile number", reason: "A code sent to the new contact (plus the current password) is the only proof the member controls it; it cannot be skipped." },
  { key: "PAYMENTS", label: "Payments and refunds", reason: "Protected by authentication, permissions and gateway verification, not by OTP." },
] as const;

const otpPolicySchema = z.object({
  NEW_DEVICE_LOGIN: z.enum(["OTP_REQUIRED", "OTP_NOT_REQUIRED"]),
  SIGNUP_VERIFICATION: z.enum(["OTP_REQUIRED", "OTP_NOT_REQUIRED"]),
});

const OTP_POLICY_KEY = "otp.policy";

export async function getOtpPolicy(): Promise<OtpPolicy> {
  const row = await repo.get(OTP_POLICY_KEY);
  if (!row) return { ...OTP_POLICY_DEFAULT };
  const parsed = otpPolicySchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...OTP_POLICY_DEFAULT };
}

/** The single question the auth flows ask. Any doubt resolves to "required". */
export async function isOtpRequired(workflow: OtpPolicyWorkflow): Promise<boolean> {
  try {
    return (await getOtpPolicy())[workflow] !== "OTP_NOT_REQUIRED";
  } catch {
    return true;
  }
}

export interface OtpPolicyView {
  policy: OtpPolicy;
  isDefault: boolean;
  updatedAt: string | null;
  updatedByAdminId: string | null;
  workflows: Array<{ key: OtpPolicyWorkflow; label: string; description: string; whenNotRequired: string; requirement: OtpRequirement }>;
  neverConfigurable: ReadonlyArray<{ key: string; label: string; reason: string }>;
  /** Whether a code could be delivered right now. Informational: it never changes what the policy enforces. */
  delivery: OtpDeliveryReadiness;
}

async function buildOtpView(policy: OtpPolicy, row: repo.PlatformSettingRow | undefined): Promise<OtpPolicyView> {
  return {
    policy,
    isDefault: !row,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedByAdminId: row?.updatedByAdminId ?? null,
    workflows: OTP_POLICY_WORKFLOWS.map((key) => ({ key, ...OTP_WORKFLOW_INFO[key], requirement: policy[key] })),
    neverConfigurable: NON_CONFIGURABLE_OTP_WORKFLOWS,
    delivery: await getOtpDeliveryReadiness(),
  };
}

export async function getOtpPolicyView(ctx: AuthContext): Promise<OtpPolicyView> {
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  return await buildOtpView(await getOtpPolicy(), await repo.get(OTP_POLICY_KEY));
}

export interface AuditMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function setOtpPolicy(
  ctx: AuthContext,
  input: { workflow: string; requirement: string; reason?: string },
  meta: AuditMeta
): Promise<OtpPolicyView> {
  // Super Admin only — the role check is deliberate on top of the permission: a custom role granted
  // platform.settings.manage still cannot loosen authentication.
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  if (ctx.subject.type !== "admin") throw new AuthorizationError();

  if (!(OTP_POLICY_WORKFLOWS as readonly string[]).includes(input.workflow)) {
    throw new ValidationError(`“${input.workflow}” is not a workflow whose OTP requirement can be configured.`);
  }
  if (input.requirement !== "OTP_REQUIRED" && input.requirement !== "OTP_NOT_REQUIRED") {
    throw new ValidationError("requirement must be OTP_REQUIRED or OTP_NOT_REQUIRED.");
  }
  const workflow = input.workflow as OtpPolicyWorkflow;
  const requirement = input.requirement as OtpRequirement;
  const reason = input.reason?.trim();
  if (requirement === "OTP_NOT_REQUIRED" && (!reason || reason.length < 5)) {
    throw new ValidationError("Switching a verification off needs a reason of at least 5 characters (it is kept in the audit log).");
  }

  const previousRow = await repo.get(OTP_POLICY_KEY);
  const previous = await getOtpPolicy();
  const next: OtpPolicy = { ...previous, [workflow]: requirement };
  const row = await repo.upsert(OTP_POLICY_KEY, next, ctx.subject.id);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "otp.policy_changed",
    entityType: "platform_setting",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      setting: OTP_POLICY_KEY,
      workflow,
      previous: previous[workflow],
      new: requirement,
      reason: reason ?? null,
      wasDefault: !previousRow,
      changedAt: row.updatedAt.toISOString(),
    },
  });
  return await buildOtpView(next, row);
}

// ---------------------------------------------------------------------------
// Search settings
// ---------------------------------------------------------------------------
