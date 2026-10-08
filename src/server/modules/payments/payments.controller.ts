/**
 * B8: HTTP layer for checkout/verify/payment-status + admin pending-
 * payments list and manual activation.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as paymentsService from "./payments.service";
import { toPaymentView } from "./payments.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const checkoutSchema = z
  .object({
    planCode: z.string().min(1, "planCode is required."),
    autoRenew: z.boolean().optional(),
    devSimulateOutcome: z.enum(["SUCCESS", "FAILED", "PENDING"]).optional(),
  })
  .strict();

export async function checkoutHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-checkout:${ctx.subject.id}`, 10, 60_000);
  const body = await parseJsonBody(req, checkoutSchema);
  const result = await paymentsService.checkout(ctx, body);
  return ok(result, "Checkout created. Complete payment with the gateway, then call verify.");
}

const paymentParamsSchema = z.object({ paymentId: uuidField });

export async function verifyPaymentHandler(req: NextRequest, params: { paymentId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-verify:${ctx.subject.id}`, 30, 60_000);
  const { paymentId } = parseParams(paymentParamsSchema, params);
  const result = await paymentsService.verifyPayment(ctx, paymentId);
  return ok({ payment: toPaymentView(result.payment), status: result.status });
}

export async function getMyPaymentHandler(req: NextRequest, params: { paymentId: string }) {
  const ctx = await authenticate(req);
  const { paymentId } = parseParams(paymentParamsSchema, params);
  const payment = await paymentsService.getMyPayment(ctx, paymentId);
  return ok({ payment: toPaymentView(payment) });
}

export async function listMyPaymentsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await paymentsService.listMyPayments(ctx);
  return ok({ payments: rows.map(toPaymentView) });
}

// --- Admin -----------------------------------------------------------------

// B13 (Performance/Scalability phase — disclosed, evidenced fix; see
// PERFORMANCE_REPORT.md / BACKEND.md's B13 section): `page`/`pageSize`
// added to close the one genuinely unbounded admin list endpoint the
// B13 pagination audit found — same query-param shape/limits every
// other admin list endpoint in this codebase already uses (see
// users-admin.controller.ts's listUsersQuerySchema).
const listPaymentsForAdminQuerySchema = z.object({
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listPaymentsForAdminHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listPaymentsForAdminQuerySchema.safeParse({
    status: sp.get("status") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Invalid query parameters.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const result = await paymentsService.listPaymentsForAdmin(ctx, parsed.data.status, parsed.data.page, parsed.data.pageSize);
  // `payments` (not `items`) is kept as the array key — the pre-existing,
  // already-tested response shape (see tests/payments.test.ts's
  // [pay-admin-rbac] asserting `data.payments`) — with a new, additive
  // `pagination` object alongside it, matching this codebase's other
  // paginated-list response shapes.
  return ok({
    payments: result.items.map(toPaymentView),
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages },
  });
}

const manualActivateSchema = z
  .object({
    reason: z.string().trim().min(1, "A reason is required."),
    gatewayTransactionId: z.string().min(1).optional(),
  })
  .strict();

export async function manualActivatePaymentHandler(req: NextRequest, params: { paymentId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-manual-activate:${ctx.subject.id}`, 20, 60_000);
  const { paymentId } = parseParams(paymentParamsSchema, params);
  const body = await parseJsonBody(req, manualActivateSchema);
  const result = await paymentsService.manualVerifyPayment(ctx, paymentId, body);
  return ok({ payment: toPaymentView(result.payment), status: result.status }, "Payment manually verified and activated.");
}
