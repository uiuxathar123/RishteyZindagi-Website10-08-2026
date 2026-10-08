/**
 * DEVELOPMENT ONLY. Lets a human running the app locally complete an OTP
 * flow, which is otherwise impossible: the backend's dev OTP provider keeps
 * codes in process memory and (by B2 design) never logs or returns them.
 *
 * Structurally absent outside local development:
 *   1. NODE_ENV=production            -> 404 (checked first, no DB access)
 *   2. otp_configs.dev_mode !== true  -> 404 (the same switch that makes the
 *      backend use the dev provider at all)
 * It only calls the existing `getDevOtpCode()` accessor — no B2 code changed.
 */
import { NextRequest, NextResponse } from "next/server";
import { devToolsAllowedByEnv } from "@/lib/bff/config";
import { get as getOtpConfig } from "@/server/modules/otp/otp-config.repository";
import { getDevOtpCode } from "@/server/modules/otp/providers/dev.provider";
import { OTP_PURPOSES, type OtpPurpose } from "@/server/modules/otp/otp.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound() {
  const res = NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest) {
  if (!devToolsAllowedByEnv()) return notFound();
  try {
    if ((await getOtpConfig()).devMode !== true) return notFound();
  } catch {
    return notFound();
  }

  const identifier = req.nextUrl.searchParams.get("identifier")?.trim() ?? "";
  const purpose = req.nextUrl.searchParams.get("purpose") ?? "";
  if (!identifier || identifier.length > 320 || !OTP_PURPOSES.includes(purpose as OtpPurpose)) return notFound();

  const code = getDevOtpCode(identifier, purpose as OtpPurpose);
  if (!code) return notFound();

  const res = NextResponse.json({ success: true, data: { code } });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
