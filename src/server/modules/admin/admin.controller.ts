import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import * as adminService from "./admin.service";

const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function adminLoginHandler(req: NextRequest) {
  const meta = {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
  checkRateLimit(`admin-login:${meta.ipAddress ?? "unknown"}`, 10, 60_000);
  const body = await parseJsonBody(req, adminLoginSchema);
  const result = await adminService.adminLogin(body, meta);
  return ok(result, "Logged in.");
}

const adminMfaSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(4).max(10),
});

export async function adminVerifyMfaHandler(req: NextRequest) {
  const meta = {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
  checkRateLimit(`admin-mfa:${meta.ipAddress ?? "unknown"}`, 10, 60_000);
  const body = await parseJsonBody(req, adminMfaSchema);
  checkRateLimit(`admin-mfa-email:${body.email}`, 10, 60_000);
  const result = await adminService.adminVerifyMfa(body, meta);
  return ok(result, "Logged in.");
}

export async function pingHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const result = adminService.ping(ctx);
  return ok(result);
}

export async function adminMeHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const result = await adminService.adminMe(ctx);
  return ok(result);
}
