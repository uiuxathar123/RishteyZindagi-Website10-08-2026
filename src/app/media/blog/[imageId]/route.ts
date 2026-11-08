import { NextResponse } from "next/server";
import { readBlogImage } from "@/server/modules/blog/blog.service";

export const dynamic = "force-dynamic";

/**
 * Public blog images (cover photos). Served outside /api so the API middleware's `no-store` does not apply: these
 * are public, immutable files (a replaced cover gets a new id), so browsers and any CDN may cache them for a year.
 */
export async function GET(_req: Request, ctx: { params: { imageId: string } }) {
  let file: Awaited<ReturnType<typeof readBlogImage>> = null;
  try {
    file = await readBlogImage(ctx.params.imageId);
  } catch {
    file = null;
  }
  if (!file) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(new Blob([file.buffer as unknown as ArrayBuffer], { type: file.contentType }), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
