"use client";

/** `/admin/blog` — Blog Manager (`blog.manage`): write, publish and remove the articles shown at /blog. */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { BlogPostRow } from "@/lib/api/b19-types";
import { ArrowLeft, ExternalLink, ImagePlus, Newspaper, Plus, Trash2 } from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";
import { ActionError, PageHeader, fieldIssue } from "./AdminUi";

type Draft = {
  title: string;
  slug: string;
  category: string;
  authorName: string;
  excerpt: string;
  content: string;
  coverImageId: string | null;
  coverImageUrl: string | null;
  coverPreview: string | null;
  coverImageAlt: string;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  publishedDate: string; // yyyy-mm-dd, optional
};

const blank: Draft = {
  title: "",
  slug: "",
  category: "",
  authorName: "RishteyZindagi Editorial Team",
  excerpt: "",
  content: "",
  coverImageId: null,
  coverImageUrl: null,
  coverPreview: null,
  coverImageAlt: "",
  seoTitle: "",
  seoDescription: "",
  isPublished: false,
  publishedDate: "",
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

function fromRow(r: BlogPostRow): Draft {
  return {
    title: r.title,
    slug: r.slug,
    category: r.category,
    authorName: r.authorName,
    excerpt: r.excerpt,
    content: r.content,
    coverImageId: r.coverImageId,
    coverImageUrl: r.coverImageUrl,
    coverPreview: r.coverSrc,
    coverImageAlt: r.coverImageAlt,
    seoTitle: r.seoTitle ?? "",
    seoDescription: r.seoDescription ?? "",
    isPublished: r.isPublished,
    publishedDate: r.publishedAt ? r.publishedAt.slice(0, 10) : "",
  };
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function BlogClient() {
  const list = useAsync((signal) => adminApi.get<{ posts: BlogPostRow[] }>("/blog", { signal }), []);
  const [editing, setEditing] = useState<BlogPostRow | "new" | null>(null);

  if (editing) {
    return (
      <BlogEditor
        row={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          list.reload();
        }}
      />
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="Blog"
        icon={<Newspaper className="h-5 w-5 text-rz-maroon" strokeWidth={1.8} />}
        description="Write and publish articles for the public Blog. Published articles appear at /blog and in sitemap.xml straight away."
        actions={<Button size="sm" onClick={() => setEditing("new")} icon={<Plus className="h-4 w-4" />}>New article</Button>}
      />
      <AsyncView data={list.data} error={list.error} loading={list.loading} reload={list.reload} skeleton={<ListSkeleton rows={4} />}>
        {(d) =>
          d.posts.length === 0 ? (
            <p className="rounded-lg border border-rz-border bg-white p-6 text-sm text-rz-muted" data-testid="blog-empty">No articles yet.</p>
          ) : (
            <ul className="space-y-3" data-testid="blog-list">
              {d.posts.map((p) => (
                <li key={p.id} className="flex gap-4 rounded-lg border border-rz-border bg-white p-4">
                  <div className="hidden h-20 w-28 shrink-0 overflow-hidden rounded-md bg-rz-peach sm:block">
                    {p.coverSrc && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.coverSrc} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-rz-navy">{p.title}</p>
                      <span
                        className={
                          p.isPublished
                            ? "rounded-full bg-rz-success/10 px-2.5 py-0.5 text-xs font-semibold text-rz-success"
                            : "rounded-full bg-rz-cream px-2.5 py-0.5 text-xs font-semibold text-rz-muted"
                        }
                      >
                        {p.isPublished ? "Published" : "Draft"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-rz-muted">
                      /blog/{p.slug} · {p.category} · {p.isPublished ? `published ${fmt(p.publishedAt)}` : `updated ${fmt(p.updatedAt)}`} · {p.readTimeMinutes} min read
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-sm text-rz-text">{p.excerpt}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                      {p.isPublished && (
                        <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" className="rz-focus inline-flex items-center gap-1 px-2 text-xs font-semibold text-rz-maroon hover:underline">
                          View on site <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return <span className={over ? "text-rz-danger" : "text-rz-muted"}>{value.length}/{max}</span>;
}

function FieldError({ error, path }: { error: Parameters<typeof fieldIssue>[0]; path: string }) {
  const msg = fieldIssue(error, path);
  return msg ? <p role="alert" className="mt-1 text-xs text-rz-danger">{msg}</p> : null;
}

function BlogEditor({ row, onClose, onSaved }: { row: BlogPostRow | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(row ? fromRow(row) : blank);
  const [slugTouched, setSlugTouched] = useState(Boolean(row));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useAction((body: Record<string, unknown>) => (row ? adminApi.patch(`/blog/${row.id}`, body) : adminApi.post("/blog", body)));
  const del = useAction(() => adminApi.delete(`/blog/${row!.id}`));
  const upload = useAction((fd: FormData) => adminApi.upload<{ imageId: string; url: string }>("/blog/images", fd));

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const onTitle = (e: ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value;
    setD((x) => ({ ...x, title, ...(slugTouched ? {} : { slug: slugify(title) }) }));
  };

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("image", file);
    const res = await upload.run(fd);
    if (res) setD((x) => ({ ...x, coverImageId: res.imageId, coverImageUrl: null, coverPreview: res.url }));
  }

  const words = useMemo(() => d.content.trim().split(/\s+/).filter(Boolean).length, [d.content]);

  async function submit(publish?: boolean) {
    const isPublished = publish ?? d.isPublished;
    const body: Record<string, unknown> = {
      title: d.title.trim(),
      slug: d.slug.trim(),
      category: d.category.trim(),
      authorName: d.authorName.trim(),
      excerpt: d.excerpt.trim(),
      content: d.content.trim(),
      coverImageAlt: d.coverImageAlt.trim(),
      seoTitle: d.seoTitle.trim() || null,
      seoDescription: d.seoDescription.trim() || null,
      isPublished,
      publishedAt: d.publishedDate ? new Date(`${d.publishedDate}T09:00:00+05:30`).toISOString() : null,
    };
    if (d.coverImageId) body.coverImageId = d.coverImageId;
    else body.coverImageUrl = d.coverImageUrl;
    if (!d.coverImageId && !d.coverImageUrl) body.coverImageId = null;
    const res = await save.run(body);
    if (res) onSaved();
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onClose} className="rz-focus inline-flex items-center gap-1.5 text-sm font-semibold text-rz-muted hover:text-rz-maroon">
          <ArrowLeft className="h-4 w-4" /> All articles
        </button>
        <div className="flex flex-wrap gap-2">
          {row && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="h-4 w-4" />}>
              Delete…
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={save.pending} onClick={() => submit(false)}>
            {save.pending ? "Saving…" : row?.isPublished ? "Unpublish & save as draft" : "Save draft"}
          </Button>
          <Button type="button" size="sm" disabled={save.pending} onClick={() => submit(true)}>
            {save.pending ? "Saving…" : row?.isPublished ? "Save changes" : "Publish"}
          </Button>
        </div>
      </div>

      <PageHeader title={row ? "Edit article" : "New article"} description={row?.isPublished ? `Live at /blog/${row.slug}` : "Drafts are visible only here until you publish them."} />

      {confirmDelete && row && (
        <div className="rounded-md border border-rz-danger/30 bg-rz-danger/5 p-4 text-sm">
          <p className="text-rz-text">Delete “{row.title}” permanently? Its page /blog/{row.slug} will stop working.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={del.pending} onClick={async () => { const r = await del.run(); if (r) onSaved(); }}>{del.pending ? "Deleting…" : "Delete article"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </div>
          <ActionError error={del.error} className="mt-2" />
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-rz-border bg-white p-5">
        <div>
          <FieldLabel htmlFor="bl-title">Title</FieldLabel>
          <Input id="bl-title" maxLength={160} value={d.title} onChange={onTitle} placeholder="How to write a profile bio that stands out" />
          <FieldError error={save.error} path="title" />
        </div>
        <div>
          <FieldLabel htmlFor="bl-slug">URL</FieldLabel>
          <div className="flex items-center gap-1 text-sm text-rz-muted">
            <span className="shrink-0">/blog/</span>
            <Input id="bl-slug" maxLength={120} value={d.slug} onChange={(e) => { setSlugTouched(true); setD((x) => ({ ...x, slug: slugify(e.target.value) || e.target.value.toLowerCase() })); }} />
          </div>
          {row?.isPublished && d.slug !== row.slug && <p className="mt-1 text-xs text-rz-maroon">Changing the URL of a published article breaks links to the old URL and loses its search ranking.</p>}
          <FieldError error={save.error} path="slug" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="bl-cat">Category</FieldLabel>
            <Input id="bl-cat" maxLength={40} value={d.category} onChange={set("category")} placeholder="Profile Tips" />
            <FieldError error={save.error} path="category" />
          </div>
          <div>
            <FieldLabel htmlFor="bl-author">Author</FieldLabel>
            <Input id="bl-author" maxLength={80} value={d.authorName} onChange={set("authorName")} />
            <FieldError error={save.error} path="authorName" />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="bl-excerpt">Short summary <span className="font-normal text-xs"><Counter value={d.excerpt} max={300} /></span></FieldLabel>
          <Textarea id="bl-excerpt" rows={2} maxLength={300} value={d.excerpt} onChange={set("excerpt")} placeholder="Shown on the blog list and, unless you set an SEO description, in search results." />
          <FieldError error={save.error} path="excerpt" />
        </div>
        <div>
          <FieldLabel htmlFor="bl-content">Article <span className="font-normal text-xs text-rz-muted">· {words} words · about {Math.max(1, Math.round(words / 200))} min read</span></FieldLabel>
          <Textarea id="bl-content" rows={18} value={d.content} onChange={set("content")} className="font-mono text-[13.5px] leading-relaxed" />
          <p className="mt-1 text-xs text-rz-muted">Leave an empty line between paragraphs. Start a line with <code>## </code> for a sub-heading and with <code>- </code> for a bullet point.</p>
          <FieldError error={save.error} path="content" />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-rz-border bg-white p-5">
        <p className="font-semibold text-rz-navy">Cover image</p>
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative h-36 w-56 overflow-hidden rounded-md border border-rz-border bg-rz-peach">
            {d.coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.coverPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-xs text-rz-muted">No cover</span>
            )}
          </div>
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickFile} />
            <Button type="button" size="sm" variant="outline" disabled={upload.pending} onClick={() => fileRef.current?.click()} icon={<ImagePlus className="h-4 w-4" />}>
              {upload.pending ? "Uploading…" : d.coverPreview ? "Replace image" : "Upload image"}
            </Button>
            {d.coverPreview && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setD((x) => ({ ...x, coverImageId: null, coverImageUrl: null, coverPreview: null }))}>Remove</Button>
            )}
            <p className="max-w-xs text-xs text-rz-muted">JPEG, PNG or WEBP, up to 8 MB. Wide images (about 1600 × 900) look best. The image is converted to WebP automatically.</p>
            <ActionError error={upload.error} />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="bl-alt">Image description (alt text)</FieldLabel>
          <Input id="bl-alt" maxLength={200} value={d.coverImageAlt} onChange={set("coverImageAlt")} placeholder="What the photo shows, for screen readers and search engines" />
        </div>
        <FieldError error={save.error} path="coverImageUrl" />
      </div>

      <div className="space-y-4 rounded-lg border border-rz-border bg-white p-5">
        <p className="font-semibold text-rz-navy">Search engines (SEO)</p>
        <div>
          <FieldLabel htmlFor="bl-seot">SEO title <span className="font-normal text-xs"><Counter value={d.seoTitle} max={70} /></span></FieldLabel>
          <Input id="bl-seot" maxLength={70} value={d.seoTitle} onChange={set("seoTitle")} placeholder={d.title || "Defaults to the article title"} />
          <FieldError error={save.error} path="seoTitle" />
        </div>
        <div>
          <FieldLabel htmlFor="bl-seod">Meta description <span className="font-normal text-xs"><Counter value={d.seoDescription} max={170} /></span></FieldLabel>
          <Textarea id="bl-seod" rows={2} maxLength={170} value={d.seoDescription} onChange={set("seoDescription")} placeholder={d.excerpt || "Defaults to the short summary"} />
          <FieldError error={save.error} path="seoDescription" />
        </div>
        <div className="rounded-md border border-rz-border bg-rz-cream/50 p-3 text-sm">
          <p className="text-xs text-rz-muted">Google preview</p>
          <p className="mt-1 truncate text-[15px] text-[#1a0dab]">{(d.seoTitle || d.title || "Article title") + " | RishteyZindagi"}</p>
          <p className="truncate text-xs text-[#006621]">rishteyzindagi.com/blog/{d.slug || "your-article"}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-rz-text">{d.seoDescription || d.excerpt || "Meta description…"}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-rz-border bg-white p-5">
        <Toggle checked={d.isPublished} onChange={(v) => setD((x) => ({ ...x, isPublished: v }))} label="Published" description="Off = draft, visible only in this admin panel." />
        <div className="max-w-xs">
          <FieldLabel htmlFor="bl-date">Publish date (optional)</FieldLabel>
          <Input id="bl-date" type="date" value={d.publishedDate} onChange={set("publishedDate")} />
          <p className="mt-1 text-xs text-rz-muted">Empty = today when you publish. A future date keeps the article hidden until that day.</p>
        </div>
      </div>

      <ActionError error={save.error} />
    </div>
  );
}
