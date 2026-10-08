/**
 * B8: HTTP layer for admin payment-gateway configuration. Same shape as
 * every other module's controller: authenticate -> rate-limit ->
 * validate -> call service -> ok(). Authorization (`platform.settings
 * .manage`) is enforced inside gateways.service.ts, mirroring
 * weights.controller.ts's own precedent (permission check lives in the
 * service, not duplicated here).
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as gatewaysService from "./gateways.service";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const gatewayParamsSchema = z.object({ gatewayId: uuidField });

export async function listGatewaysHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const gateways = await gatewaysService.listGateways(ctx);
  return ok({ gateways });
}

const updateGatewaySchema = z
  .object({
    mode: z.enum(["test", "live"]).optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    merchantId: z.string().min(1).optional(),
    webhookSecret: z.string().min(1).optional(),
  })
  .strict();

export async function updateGatewayHandler(req: NextRequest, params: { gatewayId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`gateway-config-update:${ctx.subject.id}`, 20, 60_000);
  const { gatewayId } = parseParams(gatewayParamsSchema, params);
  const body = await parseJsonBody(req, updateGatewaySchema);
  const gateway = await gatewaysService.updateGatewayConfig(ctx, gatewayId, body);
  return ok({ gateway }, "Gateway configuration updated.");
}

export async function activateGatewayHandler(req: NextRequest, params: { gatewayId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`gateway-activate:${ctx.subject.id}`, 20, 60_000);
  const { gatewayId } = parseParams(gatewayParamsSchema, params);
  const gateway = await gatewaysService.activateGateway(ctx, gatewayId);
  return ok({ gateway }, "Gateway activated.");
}

export async function deactivateGatewayHandler(req: NextRequest, params: { gatewayId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`gateway-deactivate:${ctx.subject.id}`, 20, 60_000);
  const { gatewayId } = parseParams(gatewayParamsSchema, params);
  const gateway = await gatewaysService.deactivateGateway(ctx, gatewayId);
  return ok({ gateway }, "Gateway deactivated.");
}

export async function testGatewayConnectionHandler(req: NextRequest, params: { gatewayId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`gateway-test-connection:${ctx.subject.id}`, 10, 60_000);
  const { gatewayId } = parseParams(gatewayParamsSchema, params);
  const result = await gatewaysService.testGatewayConnection(ctx, gatewayId);
  return ok(result);
}
