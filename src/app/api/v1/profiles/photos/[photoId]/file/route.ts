import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPhotoFileHandler } from "@/server/modules/profiles/profiles.controller";

export const dynamic = "force-dynamic";

// The one route in the codebase that serves raw binary bytes instead of
// the ok()/fail() JSON envelope — see getPhotoFileHandler's own comment
// in profiles.controller.ts. Errors thrown inside the handler (e.g.
// NotFoundError, AuthorizationError) still propagate through this
// wrapper and are still caught centrally by withErrorHandling, since
// they're thrown before this function returns anything.
export const GET = withErrorHandling(async (req, ctx) => {
  const { buffer, contentType } = await getPhotoFileHandler(req, ctx.params as { photoId: string });
  // NextResponse's BodyInit type doesn't cleanly accept Node's Buffer in
  // this TS/@types/node combination — Buffer's ArrayBufferLike (which
  // permits SharedArrayBuffer) doesn't structurally satisfy BlobPart's
  // stricter ArrayBuffer requirement, even though every real Buffer here
  // is backed by a plain, non-shared ArrayBuffer at runtime. The bytes
  // are correct; only the type checker needs convincing.
  return new NextResponse(new Blob([buffer as unknown as ArrayBuffer], { type: contentType }), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Private — this is a gated, per-viewer-authorized asset, never a
      // publicly cacheable one (see B3 §16).
      "Cache-Control": "private, max-age=300",
    },
  });
});
