/**
 * Blog Manager: permissions, drafts vs published, slug rules, cover upload and serving, SEO fields, audit, and the
 * plain-text renderer never emitting HTML.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { eq, inArray } from "drizzle-orm";
import { GET as listAdmin, POST as createRoute } from "@/app/api/v1/admin/blog/route";
import { PATCH as patchRoute, DELETE as deleteRoute } from "@/app/api/v1/admin/blog/[postId]/route";
import { POST as uploadRoute } from "@/app/api/v1/admin/blog/images/route";
import { GET as mediaRoute } from "@/app/media/blog/[imageId]/route";
import { db } from "@/server/db/client";
import { auditLogs, blogPosts } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { getPublishedPost, listPublishedPosts, listRelatedPosts } from "@/server/modules/blog/blog.service";
import { BlogContent } from "@/components/blog/BlogContent";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, tinyPngBuffer } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const U = "http://localhost/api/v1/admin/blog";
const SLUG_PREFIX = "zz-test-";
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const create = (token: string, body: unknown) => createRoute(jreq(U, { body, token })).then(json);
const patch = (token: string, id: string, body: unknown) => patchRoute(jreq(`${U}/${id}`, { body, token, method: "PATCH" }), { params: { postId: id } }).then(json);
const del = (token: string, id: string) => deleteRoute(jreq(`${U}/${id}`, { token, method: "DELETE" }), { params: { postId: id } }).then(json);
const upload = (token: string, buffer: Buffer, type = "image/png") => {
  const form = new FormData();
  form.set("image", new Blob([buffer as unknown as ArrayBuffer], { type }), "cover.png");
  return uploadRoute(new NextRequest(`${U}/images`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form })).then(json);
};

const article = (n: string, extra: Record<string, unknown> = {}) => ({
  slug: `${SLUG_PREFIX}${n}`,
  title: `Test article ${n}`,
  excerpt: "A short summary of this test article that is long enough.",
  content: "First paragraph of the article with enough words to pass validation easily.\n\n## A heading\n\nSecond paragraph.\n\n- one\n- two",
  category: "Testing",
  authorName: "QA Team",
  ...extra,
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  // only this suite's own rows; imported articles (migration 0022) are left alone
  const mine = (await db.select({ id: blogPosts.id, slug: blogPosts.slug }).from(blogPosts)).filter((r) => r.slug.startsWith(SLUG_PREFIX));
  if (mine.length) await db.delete(blogPosts).where(inArray(blogPosts.id, mine.map((r) => r.id)));
});

describe("Blog Manager", () => {
  it("[blog-authz] only admins with blog.manage (Super Admin by default) can list, write or upload", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const member = await createVerifiedMember("blog-member");
    expect((await listAdmin(jreq(U))).status).toBe(401);
    expect([401, 403]).toContain((await listAdmin(jreq(U, { token: member.sessionToken }))).status);
    expect((await listAdmin(jreq(U, { token: staff.token }))).status).toBe(403);
    expect((await create(staff.token, article("staff"))).status).toBe(403);
    expect((await upload(staff.token, tinyPngBuffer())).status).toBe(403);
    expect((await listAdmin(jreq(U, { token: sup.token }))).status).toBe(200);
    await grantPermission("STAFF_ADMIN", "blog.manage");
    expect((await create(staff.token, article("staff"))).status).toBe(201);
    await revokePermission("STAFF_ADMIN", "blog.manage");
  });

  it("[blog-draft-publish] a draft is never public; publishing makes it public with a publish date; unpublishing hides it again", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const c = await create(sup.token, article("draft"));
    expect(c.status).toBe(201);
    const id = c.body.data.id;
    expect(c.body.data).toMatchObject({ isPublished: false, publishedAt: null, readTimeMinutes: 1 });
    expect(await getPublishedPost(`${SLUG_PREFIX}draft`)).toBeNull();
    expect((await listPublishedPosts()).some((p) => p.id === id)).toBe(false);

    const p = await patch(sup.token, id, { isPublished: true });
    expect(p.status).toBe(200);
    expect(p.body.data.publishedAt).toBeTruthy();
    expect((await getPublishedPost(`${SLUG_PREFIX}draft`))?.id).toBe(id);
    expect((await listPublishedPosts()).some((x) => x.id === id)).toBe(true);

    const u = await patch(sup.token, id, { isPublished: false });
    expect(u.body.data.isPublished).toBe(false);
    expect(await getPublishedPost(`${SLUG_PREFIX}draft`)).toBeNull();

    // a future publish date keeps it hidden until then
    await patch(sup.token, id, { isPublished: true, publishedAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
    expect(await getPublishedPost(`${SLUG_PREFIX}draft`)).toBeNull();
  });

  it("[blog-validation] slug format and uniqueness, field limits, and external cover hosts are enforced", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    expect((await create(sup.token, article("ok"))).status).toBe(201);
    const dup = await create(sup.token, article("ok"));
    expect(dup.status).toBe(409);
    expect((await create(sup.token, { ...article("x"), slug: "Bad Slug!" })).status).toBe(400);
    expect((await create(sup.token, { ...article("short"), content: "too short" })).status).toBe(400);
    expect((await create(sup.token, { ...article("seo"), seoTitle: "x".repeat(71) })).status).toBe(400);
    expect((await create(sup.token, { ...article("evil"), coverImageUrl: "https://evil.example.com/a.jpg" })).status).toBe(400);
    expect((await create(sup.token, { ...article("http"), coverImageUrl: "http://images.pexels.com/a.jpg" })).status).toBe(400);
    expect((await create(sup.token, { ...article("pexels"), coverImageUrl: "https://images.pexels.com/photos/1/a.jpeg" })).status).toBe(201);
    expect((await create(sup.token, { ...article("extra"), html: "<b>x</b>" })).status).toBe(400); // strict: unknown fields refused
    // renaming onto an existing slug is refused too
    const other = await create(sup.token, article("other"));
    expect((await patch(sup.token, other.body.data.id, { slug: `${SLUG_PREFIX}ok` })).status).toBe(409);
  });

  it("[blog-cover] an uploaded cover is re-encoded to WebP, served publicly with long caching, and removed with its article", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const up = await upload(sup.token, tinyPngBuffer(400, 250));
    expect(up.status).toBe(201);
    const { imageId, url } = up.body.data;
    expect(url).toBe(`/media/blog/${imageId}`);
    const served = await mediaRoute(new Request(`http://localhost${url}`), { params: { imageId } });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await served.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");

    const c = await create(sup.token, article("cover", { coverImageId: imageId, coverImageAlt: "A gradient", isPublished: true }));
    expect(c.body.data.coverSrc).toBe(url);
    expect((await getPublishedPost(`${SLUG_PREFIX}cover`))?.coverSrc).toBe(url);

    expect((await upload(sup.token, Buffer.from("not an image at all"), "image/png")).status).toBe(400);
    expect((await mediaRoute(new Request("http://localhost/media/blog/x"), { params: { imageId: "../../etc/passwd" } })).status).toBe(404);

    expect((await del(sup.token, c.body.data.id)).status).toBe(200);
    expect((await mediaRoute(new Request(`http://localhost${url}`), { params: { imageId } })).status).toBe(404);
    expect(await getPublishedPost(`${SLUG_PREFIX}cover`)).toBeNull();
  });

  it("[blog-related-audit] related articles exclude the current one; every write is audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const a = await create(sup.token, article("rel-a", { isPublished: true }));
    await create(sup.token, article("rel-b", { isPublished: true }));
    const related = await listRelatedPosts(`${SLUG_PREFIX}rel-a`, 50);
    expect(related.some((r) => r.slug === `${SLUG_PREFIX}rel-a`)).toBe(false);
    expect(related.some((r) => r.slug === `${SLUG_PREFIX}rel-b`)).toBe(true);
    await patch(sup.token, a.body.data.id, { title: "Renamed test article" });
    await del(sup.token, a.body.data.id);
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, a.body.data.id))).map((r) => r.action).sort();
    expect(actions).toEqual(["blog.post_created", "blog.post_deleted", "blog.post_updated"]);
  });

  it("[blog-render-safe] the article renderer outputs text only: headings, paragraphs and lists, never raw HTML", () => {
    const html = renderToStaticMarkup(createElement(BlogContent, { content: "Hello <script>alert(1)</script>\n\n## Title <img src=x onerror=alert(1)>\n\n- a\n- <b>b</b>" }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
  });
});
