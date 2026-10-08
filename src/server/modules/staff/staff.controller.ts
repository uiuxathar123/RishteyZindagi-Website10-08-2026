import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { created, ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./staff.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();
function id(raw: string): string {
  const r = uuid.safeParse(raw);
  if (!r.success) throw new ValidationError("Invalid route parameters.");
  return r.data;
}

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
export async function listStaffHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const q = listSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ValidationError("Invalid query parameters.");
  return ok(await svc.listStaff(ctx, q.data));
}

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    roleName: z.string().trim().min(1).max(60),
  })
  .strict();
export async function createStaffHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`staff-write:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, createSchema);
  const out = await svc.createStaff(ctx, body, meta(req));
  const res = created(out, "Staff account created. Share the temporary password securely — it is shown only once.");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    roleName: z.string().trim().min(1).max(60).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export async function updateStaffHandler(req: NextRequest, p: { staffId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`staff-write:${ctx.subject.id}`, 30, 60_000);
  const staffId = id(p.staffId);
  const body = await parseJsonBody(req, updateSchema);
  return ok(await svc.updateStaff(ctx, staffId, body, meta(req)), "Staff account updated.");
}

export async function resetPasswordHandler(req: NextRequest, p: { staffId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`staff-write:${ctx.subject.id}`, 10, 60_000);
  const out = await svc.resetStaffPassword(ctx, id(p.staffId), meta(req));
  const res = ok(out, "Password reset. Share the temporary password securely — it is shown only once.");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function listRolesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.listRoles(ctx));
}

const roleSchema = z
  .object({ name: z.string().trim().min(3).max(40), description: z.string().trim().max(200).optional(), permissions: z.array(z.string().trim().min(1).max(80)).max(100) })
  .strict();
export async function createRoleHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`staff-write:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, roleSchema);
  return created(await svc.createRole(ctx, body, meta(req)), "Role created.");
}

const permsSchema = z.object({ permissions: z.array(z.string().trim().min(1).max(80)).max(100) }).strict();
export async function setRolePermissionsHandler(req: NextRequest, p: { roleId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`staff-write:${ctx.subject.id}`, 20, 60_000);
  const roleId = id(p.roleId);
  const body = await parseJsonBody(req, permsSchema);
  return ok(await svc.setRolePermissions(ctx, roleId, body.permissions, meta(req)), "Role permissions updated.");
}

const passwordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10, "Use at least 10 characters.").max(200) })
  .strict();
export async function changePasswordHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`admin-password:${ctx.subject.id}`, 5, 15 * 60_000);
  const body = await parseJsonBody(req, passwordSchema);
  return ok(await svc.changeMyPassword(ctx, body, meta(req)), "Password changed.");
}
