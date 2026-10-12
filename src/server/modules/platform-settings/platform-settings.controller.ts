import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./platform-settings.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });

const otpPolicyBody = z
  .object({
    workflow: z.string().trim().min(1).max(60),
    requirement: z.string().trim().min(1).max(30),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export async function getOtpPolicyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getOtpPolicyView(ctx));
}

export async function patchOtpPolicyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`otp-policy-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, otpPolicyBody);
  const view = await svc.setOtpPolicy(ctx, body, meta(req));
  return ok(view, "OTP policy saved.");
}

const settingsBody = z
  .object({
    search: z
      .object({
        defaultPageSize: z.number().int().optional(),
        maxPageSize: z.number().int().optional(),
        enforceAdvancedSearchEntitlement: z.boolean().optional(),
      })
      .strict()
      .optional(),
    signup: z.object({ open: z.boolean().optional(), closedMessage: z.string().max(300).optional() }).strict().optional(),
  })
  .strict()
  .refine((v) => v.search !== undefined || v.signup !== undefined, { message: "Provide search and/or signup settings." });

export async function getPlatformSettingsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getPlatformSettingsView(ctx));
}

export async function patchPlatformSettingsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`platform-settings-update:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, settingsBody);
  return ok(await svc.updatePlatformSettings(ctx, body, meta(req)), "Settings saved.");
}

// B19: Super-Admin-only site controls (maintenance mode, manual profile approval) + public status.
const siteControlsBody = z
  .object({
    maintenance: z.object({ enabled: z.boolean().optional(), message: z.string().max(300).optional() }).strict().optional(),
    approval: z.object({ manualApproval: z.boolean().optional() }).strict().optional(),
    digest: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => v.maintenance !== undefined || v.approval !== undefined || v.digest !== undefined, { message: "Provide maintenance, approval and/or digest settings." });

export async function getSiteControlsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getSiteControlsView(ctx));
}

export async function patchSiteControlsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`site-controls-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, siteControlsBody);
  return ok(await svc.updateSiteControls(ctx, body, meta(req)), "Site controls saved.");
}

export async function getPublicSiteStatusHandler() {
  return ok(await svc.getPublicSiteStatus());
}

const adminSecurityBody = z.object({ mfaRequired: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();

export async function getAdminSecurityHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getAdminSecurityView(ctx));
}

export async function patchAdminSecurityHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`admin-security-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, adminSecurityBody);
  return ok(await svc.setAdminSecurity(ctx, body, meta(req)), "Admin security saved.");
}
