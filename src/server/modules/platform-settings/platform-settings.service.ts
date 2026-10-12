/**
 * B18: typed, validated, audited platform settings.
 *
 * Three settings groups live in `platform_settings` (one JSON value per key):
 *
 *   otp.policy        which workflows require an OTP            (Super Admin only)
 *   search.settings   page-size limits, advanced-search gate    (platform.settings.manage)
 *   signup.settings   open / close new registrations            (platform.settings.manage)
 *
 * Rules
 *  - Reads are never cached: a change takes effect on the next request.
 *  - A missing row means "safe default" (OTP required everywhere, enforcement on, sign-ups open).
 *  - A stored value that no longer parses (manual edit, older shape) falls back to the safe default instead of
 *    failing open or crashing a login.
 *  - Every successful change writes an audit entry holding who changed it, the previous value and the new value
 *    (never any secret — these settings contain none).
 *  - The provider choice (EMAIL / FAST2SMS_SMS, exactly one active) lives in `otp_configs` and is NOT touched here:
 *    "which channel delivers a code" and "is a code required" are separate decisions.
 */
import { z } from "zod";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import { canDeliverEmailOtp, getOtpDeliveryReadiness, type OtpDeliveryReadiness } from "@/server/modules/otp/otp.service";
import { isMailerConfigured } from "@/server/lib/mailer";
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

export interface SearchSettings {
  defaultPageSize: number;
  maxPageSize: number;
  /** When true, filters marked "advanced" need a plan with `advancedSearch`. Super Admin can switch it off (e.g. a promotion). */
  enforceAdvancedSearchEntitlement: boolean;
}
export const SEARCH_SETTINGS_DEFAULT: SearchSettings = { defaultPageSize: 20, maxPageSize: 50, enforceAdvancedSearchEntitlement: true };

const searchSettingsSchema = z
  .object({
    defaultPageSize: z.number().int().min(5).max(50),
    maxPageSize: z.number().int().min(10).max(50), // 50 is the hard API ceiling
    enforceAdvancedSearchEntitlement: z.boolean(),
  })
  .strict()
  .refine((v) => v.defaultPageSize <= v.maxPageSize, { message: "defaultPageSize must not exceed maxPageSize.", path: ["defaultPageSize"] });

const SEARCH_KEY = "search.settings";

export async function getSearchSettings(): Promise<SearchSettings> {
  const row = await repo.get(SEARCH_KEY);
  if (!row) return { ...SEARCH_SETTINGS_DEFAULT };
  const parsed = searchSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...SEARCH_SETTINGS_DEFAULT };
}

// ---------------------------------------------------------------------------
// Sign-up switch
// ---------------------------------------------------------------------------

export interface SignupSettings {
  open: boolean;
  /** Shown to visitors when sign-ups are closed. */
  closedMessage: string;
}
export const SIGNUP_SETTINGS_DEFAULT: SignupSettings = { open: true, closedMessage: "" };

const signupSettingsSchema = z
  .object({ open: z.boolean(), closedMessage: z.string().trim().max(300) })
  .strict();

const SIGNUP_KEY = "signup.settings";

export async function getSignupSettings(): Promise<SignupSettings> {
  const row = await repo.get(SIGNUP_KEY);
  if (!row) return { ...SIGNUP_SETTINGS_DEFAULT };
  const parsed = signupSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...SIGNUP_SETTINGS_DEFAULT };
}

export interface PlatformSettingsView {
  search: SearchSettings;
  signup: SignupSettings;
  updatedAt: { search: string | null; signup: string | null };
}

export async function getPlatformSettingsView(ctx: AuthContext): Promise<PlatformSettingsView> {
  await requirePermission(ctx, "platform.settings.manage");
  const [search, signup, sRow, uRow] = await Promise.all([getSearchSettings(), getSignupSettings(), repo.get(SEARCH_KEY), repo.get(SIGNUP_KEY)]);
  return { search, signup, updatedAt: { search: sRow ? sRow.updatedAt.toISOString() : null, signup: uRow ? uRow.updatedAt.toISOString() : null } };
}

export async function updatePlatformSettings(
  ctx: AuthContext,
  input: { search?: Partial<SearchSettings>; signup?: Partial<SignupSettings> },
  meta: AuditMeta
): Promise<PlatformSettingsView> {
  await requirePermission(ctx, "platform.settings.manage");
  if (ctx.subject.type !== "admin") throw new AuthorizationError();
  const adminId = ctx.subject.id;

  if (input.search) {
    const previous = await getSearchSettings();
    const merged = { ...previous, ...input.search };
    const parsed = searchSettingsSchema.safeParse(merged);
    if (!parsed.success) throw new ValidationError("The search settings are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    await repo.upsert(SEARCH_KEY, parsed.data, adminId);
    await record({ actorType: "ADMIN", actorId: adminId, actorRole: ctx.adminRoleName, action: "settings.search_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { previous, new: parsed.data } });
  }
  if (input.signup) {
    const previous = await getSignupSettings();
    const merged = { ...previous, ...input.signup };
    const parsed = signupSettingsSchema.safeParse(merged);
    if (!parsed.success) throw new ValidationError("The sign-up settings are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    await repo.upsert(SIGNUP_KEY, parsed.data, adminId);
    await record({ actorType: "ADMIN", actorId: adminId, actorRole: ctx.adminRoleName, action: "settings.signup_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { previous, new: parsed.data } });
  }
  return getPlatformSettingsView(ctx);
}

// ---------------------------------------------------------------------------
// B19: maintenance mode + manual profile approval (both Super Admin only)
// ---------------------------------------------------------------------------

export interface MaintenanceSettings {
  enabled: boolean;
  /** Shown to members/visitors while the site is in maintenance. */
  message: string;
}
export const MAINTENANCE_DEFAULT: MaintenanceSettings = { enabled: false, message: "" };
export const MAINTENANCE_DEFAULT_MESSAGE = "RishteyZindagi is undergoing scheduled maintenance. Please try again shortly.";
const maintenanceSchema = z.object({ enabled: z.boolean(), message: z.string().trim().max(300) }).strict();
const MAINTENANCE_KEY = "site.maintenance";

/** A missing or unreadable value means "not in maintenance": a corrupt row must never lock every member out. */
export async function getMaintenance(): Promise<MaintenanceSettings> {
  const row = await repo.get(MAINTENANCE_KEY);
  if (!row) return { ...MAINTENANCE_DEFAULT };
  const parsed = maintenanceSchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...MAINTENANCE_DEFAULT };
}

export interface ApprovalSettings {
  /** When true, a profile that becomes ready for the first time waits in the queue until an admin approves it. */
  manualApproval: boolean;
}
export const APPROVAL_DEFAULT: ApprovalSettings = { manualApproval: false };
const approvalSchema = z.object({ manualApproval: z.boolean() }).strict();
const APPROVAL_KEY = "profile.approval";

export async function getApprovalSettings(): Promise<ApprovalSettings> {
  const row = await repo.get(APPROVAL_KEY);
  if (!row) return { ...APPROVAL_DEFAULT };
  const parsed = approvalSchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...APPROVAL_DEFAULT };
}

export interface DigestSettings {
  /** Master switch for the weekly member digest. Members still have to opt in individually. */
  enabled: boolean;
}
export const DIGEST_DEFAULT: DigestSettings = { enabled: true };
const digestSchema = z.object({ enabled: z.boolean() }).strict();
const DIGEST_KEY = "digest.settings";

export async function getDigestSettings(): Promise<DigestSettings> {
  const row = await repo.get(DIGEST_KEY);
  if (!row) return { ...DIGEST_DEFAULT };
  const parsed = digestSchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...DIGEST_DEFAULT };
}

export interface SiteControlsView {
  maintenance: MaintenanceSettings & { updatedAt: string | null };
  approval: ApprovalSettings & { updatedAt: string | null; pendingCount?: number };
  digest: DigestSettings & { updatedAt: string | null; mailerConfigured: boolean };
}

export async function getSiteControlsView(ctx: AuthContext): Promise<SiteControlsView> {
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  const [m, a, d, mRow, aRow, dRow] = await Promise.all([getMaintenance(), getApprovalSettings(), getDigestSettings(), repo.get(MAINTENANCE_KEY), repo.get(APPROVAL_KEY), repo.get(DIGEST_KEY)]);
  return {
    maintenance: { ...m, updatedAt: mRow ? mRow.updatedAt.toISOString() : null },
    approval: { ...a, updatedAt: aRow ? aRow.updatedAt.toISOString() : null },
    digest: { ...d, updatedAt: dRow ? dRow.updatedAt.toISOString() : null, mailerConfigured: isMailerConfigured() },
  };
}

export async function updateSiteControls(
  ctx: AuthContext,
  input: { maintenance?: Partial<MaintenanceSettings>; approval?: Partial<ApprovalSettings>; digest?: Partial<DigestSettings>; reason?: string },
  meta: AuditMeta
): Promise<SiteControlsView> {
  // Super Admin only — a custom role holding platform.settings.manage may not take the site offline or change moderation policy.
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  if (ctx.subject.type !== "admin") throw new AuthorizationError();
  const adminId = ctx.subject.id;
  const reason = input.reason?.trim() || null;

  if (input.maintenance) {
    const previous = await getMaintenance();
    const parsed = maintenanceSchema.safeParse({ ...previous, ...input.maintenance });
    if (!parsed.success) throw new ValidationError("The maintenance settings are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    if (parsed.data.enabled && !previous.enabled && (!reason || reason.length < 5)) {
      throw new ValidationError("Turning maintenance mode on needs a reason of at least 5 characters (it is kept in the audit log).");
    }
    await repo.upsert(MAINTENANCE_KEY, parsed.data, adminId);
    await record({ actorType: "ADMIN", actorId: adminId, actorRole: ctx.adminRoleName, action: "settings.maintenance_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { setting: MAINTENANCE_KEY, previous, new: parsed.data, reason } });
  }
  if (input.approval) {
    const previous = await getApprovalSettings();
    const parsed = approvalSchema.safeParse({ ...previous, ...input.approval });
    if (!parsed.success) throw new ValidationError("The approval settings are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    await repo.upsert(APPROVAL_KEY, parsed.data, adminId);
    await record({ actorType: "ADMIN", actorId: adminId, actorRole: ctx.adminRoleName, action: "settings.profile_approval_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { setting: APPROVAL_KEY, previous, new: parsed.data, reason } });
  }
  if (input.digest) {
    const previous = await getDigestSettings();
    const parsed = digestSchema.safeParse({ ...previous, ...input.digest });
    if (!parsed.success) throw new ValidationError("The digest settings are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    await repo.upsert(DIGEST_KEY, parsed.data, adminId);
    await record({ actorType: "ADMIN", actorId: adminId, actorRole: ctx.adminRoleName, action: "settings.digest_changed", entityType: "platform_setting", ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { setting: DIGEST_KEY, previous, new: parsed.data, reason } });
  }
  return getSiteControlsView(ctx);
}

/** Public, unauthenticated read for the site banner / maintenance page. Reveals nothing but on/off and the message. */
export async function getPublicSiteStatus(): Promise<{ maintenance: boolean; message: string; signupOpen: boolean }> {
  const [m, s] = await Promise.all([getMaintenance(), getSignupSettings()]);
  return { maintenance: m.enabled, message: m.enabled ? m.message || MAINTENANCE_DEFAULT_MESSAGE : "", signupOpen: s.open };
}

// ---------------------------------------------------------------------------
// B19: admin second factor (Super Admin only)
// ---------------------------------------------------------------------------

export interface AdminSecuritySettings {
  /** When true every admin (Super and Staff) must enter an e-mailed one-time code after the password. */
  mfaRequired: boolean;
}
export const ADMIN_SECURITY_DEFAULT: AdminSecuritySettings = { mfaRequired: false };
const adminSecuritySchema = z.object({ mfaRequired: z.boolean() }).strict();
const ADMIN_SECURITY_KEY = "admin.security";

/** Unreadable value → the stored default (off). Unlike the member OTP policy this setting *adds* a check, so a corrupt row
 * cannot be allowed to lock every admin out; `scripts/disable-admin-mfa.ts` is the documented break-glass. */
export async function getAdminSecurity(): Promise<AdminSecuritySettings> {
  const row = await repo.get(ADMIN_SECURITY_KEY);
  if (!row) return { ...ADMIN_SECURITY_DEFAULT };
  const parsed = adminSecuritySchema.safeParse(row.value);
  return parsed.success ? parsed.data : { ...ADMIN_SECURITY_DEFAULT };
}

export interface AdminSecurityView extends AdminSecuritySettings {
  updatedAt: string | null;
  /** Whether an e-mailed code could be delivered right now; switching MFA on is refused when false. */
  emailDeliveryReady: boolean;
}

export async function getAdminSecurityView(ctx: AuthContext): Promise<AdminSecurityView> {
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  const [s, row, ready] = await Promise.all([getAdminSecurity(), repo.get(ADMIN_SECURITY_KEY), canDeliverEmailOtp()]);
  return { ...s, updatedAt: row ? row.updatedAt.toISOString() : null, emailDeliveryReady: ready };
}

export async function setAdminSecurity(ctx: AuthContext, input: { mfaRequired: boolean; reason?: string }, meta: AuditMeta): Promise<AdminSecurityView> {
  requireAdminRole(ctx, ["SUPER_ADMIN"]);
  await requirePermission(ctx, "platform.settings.manage");
  if (ctx.subject.type !== "admin") throw new AuthorizationError();
  const previous = await getAdminSecurity();
  if (input.mfaRequired && !previous.mfaRequired) {
    // Never switch on a second factor that nobody could satisfy: that would lock every admin out, this one included.
    if (!(await canDeliverEmailOtp())) {
      throw new ConflictError("E-mail codes cannot be delivered right now (OTP is disabled or SMTP is not configured), so admin MFA cannot be switched on. Configure SMTP and the OTP settings first.");
    }
  }
  const reason = input.reason?.trim() || null;
  await repo.upsert(ADMIN_SECURITY_KEY, { mfaRequired: input.mfaRequired }, ctx.subject.id);
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "settings.admin_mfa_changed",
    entityType: "platform_setting",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { setting: ADMIN_SECURITY_KEY, previous: previous.mfaRequired, new: input.mfaRequired, reason },
  });
  return getAdminSecurityView(ctx);
}
