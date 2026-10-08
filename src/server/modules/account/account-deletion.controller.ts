import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./account-deletion.service";

function meta(req: NextRequest) {
  return { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") };
}

const deleteSchema = z.object({ password: z.string().min(1).max(200), confirmation: z.string().min(1).max(100) }).strict();

export async function deleteAccountHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`delete-account:${ctx.subject.id}`, 5, 60 * 60_000);
  const body = await parseJsonBody(req, deleteSchema);
  const result = await svc.requestAccountDeletion(ctx, body, meta(req));
  return ok(result, "Your account has been scheduled for deletion. You can recover it until the date shown.");
}

const recoverRequestSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).strict();
const recoverConfirmSchema = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().trim().min(1).max(20) }).strict();

export async function recoverRequestHandler(req: NextRequest) {
  const m = meta(req);
  checkRateLimit(`recover-request:${m.ipAddress ?? "unknown"}`, 10, 15 * 60_000);
  const body = await parseJsonBody(req, recoverRequestSchema);
  checkRateLimit(`recover-request-email:${body.email}`, 5, 60 * 60_000);
  const result = await svc.requestAccountRecovery(body, m);
  return ok(result, "If this account can be recovered, a verification code has been sent.");
}

export async function recoverConfirmHandler(req: NextRequest) {
  const m = meta(req);
  checkRateLimit(`recover-confirm:${m.ipAddress ?? "unknown"}`, 20, 15 * 60_000);
  const body = await parseJsonBody(req, recoverConfirmSchema);
  const result = await svc.confirmAccountRecovery(body, m);
  return ok(result, "Your account has been recovered. You can sign in now.");
}

const listSchema = z.object({
  state: z.enum(["PENDING", "FINALIZED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listDeletionsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query parameters.");
  return ok(await svc.listAccountDeletionsForAdmin(ctx, parsed.data));
}
