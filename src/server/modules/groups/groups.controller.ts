import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok, created } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import * as svc from "./groups.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();
const idOr404 = (v: string, what: string) => {
  if (!uuid.safeParse(v).success) throw new NotFoundError(`${what} not found.`);
  return v;
};
function paging(req: NextRequest) {
  const q = new URL(req.url).searchParams;
  const parsed = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional() }).safeParse({ page: q.get("page") ?? undefined, pageSize: q.get("pageSize") ?? undefined });
  if (!parsed.success) throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return { q, ...parsed.data };
}

// ---- member --------------------------------------------------------------------
export async function listGroupsHandler(req: NextRequest) {
  return ok(await svc.listGroups(await authenticate(req)));
}
export async function getGroupHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  return ok({ group: await svc.getGroup(ctx, idOr404(p.groupId, "Group")) });
}
export async function joinGroupHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-join:${ctx.subject.id}`, 20, 60_000);
  return ok({ group: await svc.joinGroup(ctx, idOr404(p.groupId, "Group")) }, "You joined the group.");
}
export async function leaveGroupHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-join:${ctx.subject.id}`, 20, 60_000);
  return ok(await svc.leaveGroup(ctx, idOr404(p.groupId, "Group")), "You left the group.");
}
export async function listPostsHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  const { page, pageSize } = paging(req);
  return ok(await svc.listPosts(ctx, idOr404(p.groupId, "Group"), page, pageSize));
}
export async function createPostHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-post:${ctx.subject.id}`, 10, 60_000);
  checkRateLimit(`group-post-day:${ctx.subject.id}`, 100, 24 * 60 * 60_000);
  const body = await parseJsonBody(req, svc.postSchema);
  return created({ post: await svc.createPost(ctx, idOr404(p.groupId, "Group"), body.body) }, "Posted.");
}
export async function deletePostHandler(req: NextRequest, p: { postId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-post-delete:${ctx.subject.id}`, 30, 60_000);
  return ok(await svc.deleteOwnPost(ctx, idOr404(p.postId, "Post")), "Post deleted.");
}
export async function reportPostHandler(req: NextRequest, p: { postId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-report:${ctx.subject.id}`, 10, 60 * 60_000);
  const body = await parseJsonBody(req, svc.reportSchema);
  return ok(await svc.reportPost(ctx, idOr404(p.postId, "Post"), body.reason), "Thank you — a moderator will look at it.");
}

// ---- admin ---------------------------------------------------------------------
export async function listGroupsAdminHandler(req: NextRequest) {
  return ok(await svc.listGroupsAdmin(await authenticate(req)));
}
export async function createGroupHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return created({ group: await svc.createGroup(ctx, body, meta(req)) }, "Group created.");
}
export async function updateGroupHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return ok({ group: await svc.updateGroup(ctx, idOr404(p.groupId, "Group"), body, meta(req)) }, "Group saved.");
}
export async function listPostsAdminHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  const { q, page, pageSize } = paging(req);
  const f = q.get("filter");
  const filter = f === "reported" || f === "hidden" ? f : "all";
  return ok(await svc.listPostsAdmin(ctx, idOr404(p.groupId, "Group"), filter, page, pageSize));
}
export async function setPostHiddenHandler(req: NextRequest, p: { postId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, svc.hideSchema);
  return ok(await svc.setPostHidden(ctx, idOr404(p.postId, "Post"), body, meta(req)), "Saved.");
}
export async function listMembersAdminHandler(req: NextRequest, p: { groupId: string }) {
  const ctx = await authenticate(req);
  return ok(await svc.listMembersAdmin(ctx, idOr404(p.groupId, "Group")));
}
export async function setMemberRemovedHandler(req: NextRequest, p: { groupId: string; userId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`group-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, svc.removeSchema);
  return ok(await svc.setMemberRemoved(ctx, idOr404(p.groupId, "Group"), idOr404(p.userId, "Member"), body, meta(req)), "Saved.");
}
