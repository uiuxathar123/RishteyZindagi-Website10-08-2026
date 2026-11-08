import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { BlogContent } from "@/components/blog/BlogContent";
import { getPublishedPost, listPublishedPosts, listRelatedPosts, type BlogPostView } from "@/server/modules/blog/blog.service";
import { CalendarDays, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";

// Articles are managed at runtime in Admin → Blog.
// Cached for 60 s (load test 2026-11-09: rendering this page on every request cost ~1.6 s at 500 users);
// admin edits refresh it immediately via refreshPublicPages (src/server/lib/revalidate.ts).
export const revalidate = 60;

/** Published articles are pre-rendered at build time; any other slug (an article published later) is rendered on
 * its first visit and then cached like the rest. Without this list Next.js renders the route on every request. */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    return (await listPublishedPosts()).map((p) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

interface BlogPostPageProps {
  params: { slug: string };
}

async function load(slug: string): Promise<BlogPostView | null> {
  try {
    return await getPublishedPost(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const post = await load(params.slug);
  if (!post) return { title: "Article Not Found", robots: { index: false } };
  const description = post.seoDescription ?? post.excerpt;
  return {
    title: post.seoTitle ?? post.title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.seoTitle ?? post.title,
      description,
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      modifiedTime: post.updatedAt,
      authors: [post.authorName],
      ...(post.coverSrc ? { images: [{ url: post.coverSrc, alt: post.coverImageAlt }] } : {}),
    },
  };
}

function formatDate(iso: string | null, month: "long" | "short" = "long") {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month, year: "numeric" }) : "";
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const post = await load(params.slug);
  if (!post) notFound();

  let related: BlogPostView[] = [];
  try {
    related = await listRelatedPosts(post.slug, 3);
  } catch {
    related = [];
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.seoDescription ?? post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { "@type": "Organization", name: post.authorName },
    publisher: { "@type": "Organization", name: "RishteyZindagi" },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    ...(post.coverSrc ? { image: post.coverSrc.startsWith("/") ? `${SITE_URL}${post.coverSrc}` : post.coverSrc } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="relative h-[280px] w-full overflow-hidden bg-rz-peach md:h-[380px]">
        {post.coverSrc && (
          <Image
            src={post.coverSrc}
            alt={post.coverImageAlt}
            fill
            sizes="100vw"
            priority
            unoptimized={post.coverSrc.startsWith("/media/")}
            className="object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-rz-navy-dark/70 via-rz-navy-dark/10 to-transparent" />
      </div>

      <Section className="!pt-10">
        <Container className="max-w-2xl">
          <Badge tone="navy">{post.category}</Badge>
          <h1 className="mt-4 font-serif text-3xl font-bold leading-tight text-rz-navy md:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-rz-border pb-6 text-sm text-rz-muted">
            <span className="font-medium text-rz-text">{post.authorName}</span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {formatDate(post.publishedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {post.readTimeMinutes} min read
            </span>
          </div>

          <div className="mt-8">
            <BlogContent content={post.content} />
          </div>
        </Container>
      </Section>

      {related.length > 0 && (
        <Section className="bg-rz-cream !pt-0">
          <Container>
            <h2 className="mb-6 font-serif text-2xl font-bold text-rz-navy">More from the journal</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/blog/${r.slug}`}
                  className="rz-focus group flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white transition-shadow duration-200 hover:shadow-card-sm"
                >
                  <div className="relative aspect-[3/2] w-full overflow-hidden bg-rz-peach">
                    {r.coverSrc && (
                      <Image
                        src={r.coverSrc}
                        alt={r.coverImageAlt}
                        fill
                        unoptimized={r.coverSrc.startsWith("/media/")}
                        sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="font-serif text-base font-semibold leading-snug text-rz-navy group-hover:text-rz-maroon">
                      {r.title}
                    </h3>
                    <p className="mt-2 text-xs text-rz-muted">
                      {r.readTimeMinutes} min read · {formatDate(r.publishedAt, "short")}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        </Section>
      )}
    </>
  );
}
