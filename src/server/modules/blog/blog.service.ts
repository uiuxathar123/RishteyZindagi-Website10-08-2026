/**
 * Blog Manager. Admins with `blog.manage` (Super Admin by default) write, publish and remove articles in
 * Admin → Blog; the public /blog pages and sitemap.xml read published articles from here.
 *
 *  - A post is public only while `isPublished` is true. Publishing stamps `publishedAt` the first time (it can be
 *    set explicitly, e.g. to keep the original date of an imported article).
 *  - The slug is the article's URL (/blog/<slug>): lowercase letters, digits and single hyphens, unique.
 *  - Content is plain text (see the schema comment); nothing an admin types is ever rendered as HTML.
 *  - Cover images are re-encoded to WebP by the same converter as member photos (metadata stripped, size capped)
 *    and stored under `blog/<uuid>.webp`. External cover URLs are limited to hosts the site's CSP allows.
 *  - Every create, update, delete and image upload is written to the audit log.
 */
import { randomUUID } from "crypto";
import { and, desc, eq, isNotNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { blogPosts } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { getStorageProvider } from "@/server/modules/storage/factory";
import { inspectImage } from "@/server/modules/storage/image-inspect";
import { convertPhotoToWebp } from "@/server/modules/storage/photo-convert";
import { refreshPublicPages } from "@/server/lib/revalidate";

export const BLOG_PERMISSION = "blog.manage";
type Meta = { ipAddress?: string | null; userAgent?: string | null };
type Row = typeof blogPosts.$inferSelect;

/** Hosts an external cover URL may point at — must match next.config.js's img-src. */
const EXTERNAL_IMAGE_HOSTS = new Set(["images.pexels.com"]);
export const MAX_COVER_BYTES = 8 * 1024 * 1024;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const postFields = z.object({
  slug: z.string().trim().toLowerCase().min(3).max(120).regex(SLUG, "Use lowercase letters, numbers and single hyphens only (e.g. my-first-post)."),
  title: z.string().trim().min(5).max(160),
  excerpt: z.string().trim().min(20).max(300),
  content: z.string().trim().min(50).max(50_000),
  category: z.string().trim().min(2).max(40),
  authorName: z.string().trim().min(2).max(80),
  coverImageId: z.string().uuid().nullable().optional(),
  coverImageUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === "https:" && EXTERNAL_IMAGE_HOSTS.has(url.hostname);
      } catch {
        return false;
      }
    }, "Only images uploaded here, or https images from images.pexels.com, can be used as the cover.")
    .nullable()
    .optional(),
  coverImageAlt: z.string().trim().max(200).optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(170),
  isPublished: z.boolean(),
  publishedAt: z.coerce.date().nullable().optional(),
});
export const postCreateSchema = postFields.extend({ isPublished: postFields.shape.isPublished.default(false) }).strict();
export const postUpdateSchema = postFields.partial().strict();

export interface BlogPostView {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  authorName: string;
  coverImageId: string | null;
  coverImageUrl: string | null;
  /** What to put in <img src>: the uploaded image, else the external URL, else null. */
  coverSrc: string | null;
  coverImageAlt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  readTimeMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export function coverSrcOf(r: Pick<Row, "coverImageId" | "coverImageUrl">): string | null {
  if (r.coverImageId) return `/media/blog/${r.coverImageId}`;
  return r.coverImageUrl ?? null;
}

export function readTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const toView = (r: Row): BlogPostView => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  content: r.content,
  category: r.category,
  authorName: r.authorName,
  coverImageId: r.coverImageId,
  coverImageUrl: r.coverImageUrl,
  coverSrc: coverSrcOf(r),
  coverImageAlt: r.coverImageAlt,
  seoTitle: r.seoTitle,
  seoDescription: r.seoDescription,
  isPublished: r.isPublished,
  publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  readTimeMinutes: readTimeMinutes(r.content),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

function issues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ---- public -------------------------------------------------------------------------------------------------

const publishedNow = () => and(eq(blogPosts.isPublished, true), isNotNull(blogPosts.publishedAt), lte(blogPosts.publishedAt, new Date()));

export async function listPublishedPosts(limit = 200): Promise<BlogPostView[]> {
  const rows = await db.select().from(blogPosts).where(publishedNow()).orderBy(desc(blogPosts.publishedAt)).limit(limit);
  return rows.map(toView);
}

export async function getPublishedPost(slug: string): Promise<BlogPostView | null> {
  if (!SLUG.test(slug)) return null;
  const [row] = await db.select().from(blogPosts).where(and(eq(blogPosts.slug, slug), publishedNow())).limit(1);
  return row ? toView(row) : null;
}

export async function listRelatedPosts(slug: string, limit = 3): Promise<BlogPostView[]> {
  const rows = await db
    .select()
    .from(blogPosts)
    .where(and(publishedNow(), ne(blogPosts.slug, slug)))
    .orderBy(desc(blogPosts.publishedAt))
    .limit(limit);
  return rows.map(toView);
}

/** Bytes of an uploaded blog image, or null. Images are public once uploaded (ids are random UUIDs). */
export async function readBlogImage(imageId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!z.string().uuid().safeParse(imageId).success) return null;
  const file = await getStorageProvider().read(`blog/${imageId}.webp`);
  // Every blog image is stored as WebP by uploadCoverImage; some providers (local disk) do not keep the type.
  return file ? { buffer: file.buffer, contentType: "image/webp" } : null;
}

// ---- admin --------------------------------------------------------------------------------------------------

export async function listPostsAdmin(ctx: AuthContext): Promise<{ posts: BlogPostView[] }> {
  await requirePermission(ctx, BLOG_PERMISSION);
  const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt)).limit(500);
  return { posts: rows.map(toView) };
}

export async function createPost(ctx: AuthContext, input: unknown, meta: Meta): Promise<BlogPostView> {
  await requirePermission(ctx, BLOG_PERMISSION);
  const parsed = postCreateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("The article is invalid.", issues(parsed.error));
  const d = parsed.data;
  const publishedAt = d.isPublished ? (d.publishedAt ?? new Date()) : (d.publishedAt ?? null);
  let row: Row;
  try {
    [row] = await db
      .insert(blogPosts)
      .values({
        ...d,
        coverImageId: d.coverImageId ?? null,
        coverImageUrl: d.coverImageId ? null : (d.coverImageUrl ?? null),
        coverImageAlt: d.coverImageAlt ?? "",
        publishedAt,
        createdByAdminId: ctx.subject.id,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Another article already uses this URL (slug). Choose a different one.", [{ path: "slug", message: "Already in use." }]);
    throw err;
  }
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "blog.post_created", entityType: "blog_post", entityId: row.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { slug: row.slug, isPublished: row.isPublished } });
  refreshPublicPages({ path: "/blog", type: "layout" });
  return toView(row);
}

export async function updatePost(ctx: AuthContext, id: string, input: unknown, meta: Meta): Promise<BlogPostView> {
  await requirePermission(ctx, BLOG_PERMISSION);
  const parsed = postUpdateSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new ValidationError("The article changes are invalid.", parsed.success ? undefined : issues(parsed.error));
  }
  const [existing] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Article not found.");
  const d = parsed.data;
  const patch: Partial<typeof blogPosts.$inferInsert> = { ...d, updatedAt: new Date() };
  if (d.coverImageId) patch.coverImageUrl = null;
  if (d.coverImageUrl) patch.coverImageId = null;
  const willBePublished = d.isPublished ?? existing.isPublished;
  if (willBePublished && !(d.publishedAt ?? existing.publishedAt)) patch.publishedAt = new Date();
  let row: Row;
  try {
    [row] = await db.update(blogPosts).set(patch).where(eq(blogPosts.id, id)).returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Another article already uses this URL (slug). Choose a different one.", [{ path: "slug", message: "Already in use." }]);
    throw err;
  }
  // An uploaded cover that was replaced or removed is deleted from storage (best effort).
  if (existing.coverImageId && existing.coverImageId !== row.coverImageId) await deleteImageQuietly(existing.coverImageId);
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "blog.post_updated", entityType: "blog_post", entityId: id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { slug: row.slug, wasPublished: existing.isPublished, isPublished: row.isPublished, fields: Object.keys(d) } });
  refreshPublicPages({ path: "/blog", type: "layout" });
  return toView(row);
}

export async function deletePost(ctx: AuthContext, id: string, meta: Meta): Promise<void> {
  await requirePermission(ctx, BLOG_PERMISSION);
  const [deleted] = await db.delete(blogPosts).where(eq(blogPosts.id, id)).returning();
  if (!deleted) throw new NotFoundError("Article not found.");
  if (deleted.coverImageId) await deleteImageQuietly(deleted.coverImageId);
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "blog.post_deleted", entityType: "blog_post", entityId: id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { slug: deleted.slug, title: deleted.title } });
  refreshPublicPages({ path: "/blog", type: "layout" });
}

export async function uploadCoverImage(ctx: AuthContext, buffer: Buffer, meta: Meta): Promise<{ imageId: string; url: string; width: number; height: number }> {
  await requirePermission(ctx, BLOG_PERMISSION);
  if (buffer.length === 0) throw new ValidationError("The file is empty.");
  if (buffer.length > MAX_COVER_BYTES) throw new ValidationError(`The image is too large. The limit is ${MAX_COVER_BYTES / 1024 / 1024} MB.`);
  if (!inspectImage(buffer)) throw new ValidationError("Please upload a JPEG, PNG or WEBP image.");
  const converted = await convertPhotoToWebp(buffer);
  const imageId = randomUUID();
  await getStorageProvider().upload({ key: `blog/${imageId}.webp`, buffer: converted.buffer, contentType: converted.contentType });
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "blog.image_uploaded", entityType: "blog_image", entityId: imageId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { width: converted.width, height: converted.height, bytes: converted.buffer.length } });
  return { imageId, url: `/media/blog/${imageId}`, width: converted.width, height: converted.height };
}

async function deleteImageQuietly(imageId: string): Promise<void> {
  try {
    await getStorageProvider().delete(`blog/${imageId}.webp`);
  } catch {
    /* a missing file is not an error here */
  }
}
