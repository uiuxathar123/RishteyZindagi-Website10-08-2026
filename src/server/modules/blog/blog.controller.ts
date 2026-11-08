import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { created, ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import * as svc from "./blog.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const idOr404 = (v: string) => {
  if (!z.string().uuid().safeParse(v).success) throw new NotFoundError("Article not found.");
  return v;
};

export async function listPostsAdminHandler(req: NextRequest) {
  return ok(await svc.listPostsAdmin(await authenticate(req)));
}
export async function createPostHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`blog-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return created(await svc.createPost(ctx, body, meta(req)), "Article created.");
}
export async function updatePostHandler(req: NextRequest, params: { postId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`blog-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return ok(await svc.updatePost(ctx, idOr404(params.postId), body, meta(req)), "Article saved.");
}
export async function deletePostHandler(req: NextRequest, params: { postId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`blog-write:${ctx.subject.id}`, 60, 60_000);
  await svc.deletePost(ctx, idOr404(params.postId), meta(req));
  return ok({ deleted: true }, "Article deleted.");
}
export async function uploadImageHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`blog-image:${ctx.subject.id}`, 30, 60_000);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("Expected multipart/form-data with an 'image' file field.");
  }
  const file = form.get("image");
  if (!file || !(file instanceof File)) throw new ValidationError("Missing 'image' file field.");
  if (file.size > svc.MAX_COVER_BYTES) throw new ValidationError(`The image is too large. The limit is ${svc.MAX_COVER_BYTES / 1024 / 1024} MB.`);
  const buffer = Buffer.from(await file.arrayBuffer());
  return created(await svc.uploadCoverImage(ctx, buffer, meta(req)), "Image uploaded.");
}
