import { z } from "zod";
import type { NextRequest } from "next/server";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { created, ok } from "@/server/lib/response";
import { authenticate } from "@/server/middleware/authenticate";
import * as authService from "./auth.service";
import type { RequestMeta } from "./auth.service";
import * as otpService from "@/server/modules/otp/otp.service";
import { record } from "@/server/modules/audit/audit.service";

function requestMeta(req: NextRequest): RequestMeta {
  return {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
    deviceId: req.headers.get("x-device-id"),
  };
}

function ipKey(meta: RequestMeta) {
  return meta.ipAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Signup: register -> verify-signup-otp -> set-password
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  mobileNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,15}$/, "Mobile number must be 6-15 digits, no country code or symbols"),
  countryCode: z
    .string()
    .trim()
    .regex(/^\+[0-9]{1,4}$/, "Country code must look like +91")
    .optional(),
});

export async function registerHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`register:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, registerSchema);
  const result = await authService.register(body, meta);
  return created(result, "Verification code sent.");
}

const verifySignupOtpSchema = z.object({
  identifier: z.string().trim().min(1),
  code: z.string().trim().min(1),
});

export async function verifySignupOtpHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`verify-signup-otp:${ipKey(meta)}`, 20, 60_000);
  const body = await parseJsonBody(req, verifySignupOtpSchema);
  const result = await authService.verifySignupOtp(body);
  return ok(result, "Code verified.");
}

const setPasswordSchema = z.object({
  identifier: z.string().trim().min(1),
  ticket: z.string().trim().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function setPasswordHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`set-password:${ipKey(meta)}`, 20, 60_000);
  const body = await parseJsonBody(req, setPasswordSchema);
  const result = await authService.setPassword(body, meta);
  return created(result, "Account created.");
}

// ---------------------------------------------------------------------------
// Resend OTP (generic — any purpose)
// ---------------------------------------------------------------------------

const resendOtpSchema = z.object({
  identifier: z.string().trim().min(1),
  purpose: z.enum(["SIGNUP", "LOGIN", "FORGOT_PASSWORD", "NEW_DEVICE"]),
});

export async function resendOtpHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`resend-otp:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, resendOtpSchema);
  const result = await otpService.resendOtp(body.identifier, body.purpose, meta);
  await record({
    actorType: "SYSTEM",
    action: "otp.resend_requested",
    entityType: "otp",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { identifier: body.identifier, purpose: body.purpose },
  });
  return ok(result, "Verification code sent.");
}

// ---------------------------------------------------------------------------
// Login (password), device verification, login (OTP)
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export async function loginHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`login:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, loginSchema);
  const result = await authService.login(body, meta);
  if ("deviceVerificationRequired" in result) {
    return ok(result, "This is a new device. Enter the code we sent to verify it.");
  }
  return ok(result, "Logged in.");
}

const verifyDeviceSchema = z.object({
  identifier: z.string().trim().min(1),
  code: z.string().trim().min(1),
});

export async function verifyDeviceHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`verify-device:${ipKey(meta)}`, 20, 60_000);
  const body = await parseJsonBody(req, verifyDeviceSchema);
  const result = await authService.verifyDevice(body, meta);
  return ok(result, "Logged in.");
}

const requestLoginOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
});

export async function requestLoginOtpHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`request-login-otp:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, requestLoginOtpSchema);
  const result = await authService.requestLoginOtp(body.email, meta);
  return ok(result, "If that account exists, a verification code has been sent.");
}

const verifyLoginOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  code: z.string().trim().min(1),
});

export async function verifyLoginOtpHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`verify-login-otp:${ipKey(meta)}`, 20, 60_000);
  const body = await parseJsonBody(req, verifyLoginOtpSchema);
  const result = await authService.verifyLoginOtp(body, meta);
  return ok(result, "Logged in.");
}

// ---------------------------------------------------------------------------
// Forgot password / reset password
// ---------------------------------------------------------------------------

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
});

export async function forgotPasswordHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`forgot-password:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, forgotPasswordSchema);
  const result = await authService.forgotPassword(body.email, meta);
  return ok(result, "If that account exists, a verification code has been sent.");
}

const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  code: z.string().trim().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetPasswordHandler(req: NextRequest) {
  const meta = requestMeta(req);
  checkRateLimit(`reset-password:${ipKey(meta)}`, 10, 60_000);
  const body = await parseJsonBody(req, resetPasswordSchema);
  await authService.resetPassword(body, meta);
  return ok(null, "Password reset. Please log in with your new password.");
}

// ---------------------------------------------------------------------------
// Logout / logout-all
// ---------------------------------------------------------------------------

export async function logoutHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  await authService.logout(ctx.subject, ctx.sessionId);
  return ok(null, "Logged out.");
}

export async function logoutAllHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sessionsRevoked = await authService.logoutAll(ctx.subject);
  return ok({ sessionsRevoked }, "Logged out of all devices.");
}
