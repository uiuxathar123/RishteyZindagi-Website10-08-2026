/**
 * HTTP layer for the Super Admin members directory and invitations. Admin handlers check the Super Admin role
 * first, before any parameter or body validation (the services check again); the member handler needs a member.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate, type AuthContext } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { ValidationError } from "@/server/lib/errors";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { created, ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as invitations from "./invitations.service";
import { listDirectory } from "./introductions.service";
import { DIRECTORY_FILTERS, type DirectoryFilter } from "./introductions.repository";
import { INVITATION_STATUSES, type InvitationStatus } from "./invitations.repository";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();

function idParam(raw: Record<string, string>, key: string): string {
  const parsed = uuid.safeParse(raw[key]);
  if (!parsed.success) throw new ValidationError(`${key} must be a valid id.`);
  return parsed.data;
}

async function superAdmin(req: NextRequest): Promise<AuthContext> {
  const ctx = await authenticate(req);
  requireSuperAdmin(ctx);
  return ctx;
}

const page = (sp: URLSearchParams, max: number, fallback: number) => ({
  page: Math.max(1, Number(sp.get("page") ?? 1) || 1),
  pageSize: Math.min(max, Math.max(1, Number(sp.get("pageSize") ?? fallback) || fallback)),
});

export async function adminDirectoryHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-search:${ctx.subject.id}`, 120, 60_000);
  const sp = new URL(req.url).searchParams;
  const filter = sp.get("filter") ?? "all";
  if (!(DIRECTORY_FILTERS as readonly string[]).includes(filter)) throw new ValidationError("Unknown filter.");
  const gender = sp.get("gender") ?? undefined;
  if (gender !== undefined && gender !== "MALE" && gender !== "FEMALE") throw new ValidationError("Unknown gender.");
  return ok(await listDirectory(ctx, { q: (sp.get("q") ?? "").slice(0, 120), filter: filter as DirectoryFilter, gender, ...page(sp, 50, 25) }));
}

export async function adminListInvitationsHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? undefined;
  if (status !== undefined && !(INVITATION_STATUSES as readonly string[]).includes(status)) throw new ValidationError("Unknown invitation status.");
  return ok(await invitations.listInvitations(ctx, { status: status as InvitationStatus | undefined, ...page(sp, 100, 25) }));
}

const inviteSchema = z
  .object({
    userId: uuid,
    kind: z.enum(["OFFER", "COMPLIMENTARY"]),
    messageToMember: z.string().max(1000).optional(),
    includedMembershipDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

export async function adminInviteHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, inviteSchema);
  return created({ invitation: await invitations.inviteMember(ctx, body, meta(req)) }, "Invitation sent.");
}

export async function adminRevokeInvitationHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  return ok({ invitation: await invitations.revokeInvitation(ctx, idParam(rawParams, "invitationId"), meta(req)) }, "Invitation revoked.");
}

const answerSchema = z.discriminatedUnion("response", [
  z.object({ response: z.literal("DECLINE") }).strict(),
  z
    .object({
      response: z.literal("ACCEPT"),
      consent: z.literal(true),
      consentVersion: z.string().min(1).max(40),
      customerNotes: z.string().max(2000).optional(),
    })
    .strict(),
]);

export async function respondToInvitationHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-respond:${ctx.subject.id}`, 30, 60_000);
  const id = idParam(rawParams, "invitationId");
  const body = await parseJsonBody(req, answerSchema);
  return ok(await invitations.respondToInvitation(ctx, id, body), "Response saved.");
}
