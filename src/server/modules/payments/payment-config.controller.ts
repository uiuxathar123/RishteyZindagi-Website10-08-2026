import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./payment-config.service";
import type { GatewayKey } from "./payment-config.service";

function meta(req: NextRequest) {
  return { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") };
}

function parseGateway(raw: string): GatewayKey {
  const value = raw.toUpperCase();
  if (value !== "RAZORPAY" && value !== "PHONEPE") {
    throw new ValidationError("Unknown gateway. Allowed values: RAZORPAY, PHONEPE.");
  }
  return value;
}

export async function getPaymentConfigHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getPaymentConfig(ctx));
}

const switchSchema = z.object({ activeGateway: z.enum(["RAZORPAY", "PHONEPE"]) }).strict();

export async function patchPaymentConfigHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-config:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, switchSchema);
  const view = await svc.setActiveGateway(ctx, body.activeGateway, meta(req));
  return ok(view, `${body.activeGateway === "RAZORPAY" ? "Razorpay" : "PhonePe"} is now the active payment gateway.`);
}

const secret = z.string().trim().min(8).max(512);
const razorpayCredsSchema = z
  .object({
    mode: z.enum(["test", "live"]).optional(),
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{6,}$/, "Razorpay key ids look like rzp_test_… or rzp_live_…").optional(),
    keySecret: secret.optional(),
    webhookSecret: secret.optional(),
  })
  .strict();
const phonepeCredsSchema = z
  .object({
    mode: z.enum(["test", "live"]).optional(),
    clientId: z.string().trim().min(3).max(256).optional(),
    clientSecret: secret.optional(),
    clientVersion: z.string().trim().min(1).max(32).optional(),
    webhookUsername: z.string().trim().min(3).max(64).optional(),
    webhookPassword: z.string().trim().min(6).max(128).optional(),
  })
  .strict();

export async function putCredentialsHandler(req: NextRequest, params: { gateway: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-config:${ctx.subject.id}`, 20, 60_000);
  const key = parseGateway(params.gateway);
  const body = await parseJsonBody(req, key === "RAZORPAY" ? razorpayCredsSchema : phonepeCredsSchema);
  if (Object.keys(body).length === 0) throw new ValidationError("At least one field must be provided.");
  const view = await svc.saveCredentials(ctx, key, body as svc.SaveCredentialsInput, meta(req));
  return ok(view, "Gateway credentials saved.");
}

export async function testConnectionHandler(req: NextRequest, params: { gateway: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-config-test:${ctx.subject.id}`, 10, 60_000);
  const key = parseGateway(params.gateway);
  return ok(await svc.testConnection(ctx, key));
}
