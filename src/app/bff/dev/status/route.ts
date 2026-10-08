/**
 * Tells the UI whether the development-only OTP helper exists on this
 * server, so a screen can decide whether to show its "development mode"
 * box. Never returns a code. Always `available: false` in production.
 */
import { NextResponse } from "next/server";
import { devToolsAllowedByEnv } from "@/lib/bff/config";
import { get as getOtpConfig } from "@/server/modules/otp/otp-config.repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let available = false;
  if (devToolsAllowedByEnv()) {
    try {
      available = (await getOtpConfig()).devMode === true;
    } catch {
      available = false;
    }
  }
  const res = NextResponse.json({ success: true, data: { available } });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
