import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { listPublishedPosts, type BlogPostView } from "@/server/modules/blog/blog.service";
import { CalendarDays, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

// Articles are managed at runtime in Admin → Blog.
// Cached for 60 s (load test 2026-11-09: rendering this page on every request cost ~1.6 s at 500 users);
// admin edits refresh it immediately via refreshPublicPages (src/server/lib/revalidate.ts).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical, warm advice on matrimony, NRI matchmaking, family involvement and safe searching — from the RishteyZindagi editorial team.",
  alternates: { canonical: "/blog" },
};

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default async function BlogIndexPage() {
  let posts: BlogPostView[] = [];
  try {
    posts = await listPublishedPosts();
  } catch {
    /* database unreachable: show the empty state */
  }

  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">
            From Our Journal
          </p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            Thoughtful reading for your search
          </h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            Practical, warm advice on profiles, family, NRI matchmaking and staying safe —
            written for the way real searches actually happen.
          </p>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          {posts.length === 0 ? (
            <p className="mx-auto max-w-xl rounded-lg border border-rz-border bg-white p-8 text-center text-sm text-rz-muted">
              New articles are on their way. Please check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="rz-focus group flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white transition-shadow duration-200 hover:shadow-card-sm"
                >
                  <div className="relative aspect-[3/2] w-full overflow-hidden bg-rz-peach">
                    {post.coverSrc && (
                      <Image
                        src={post.coverSrc}
                        alt={post.coverImageAlt}
                        fill
                        unoptimized={post.coverSrc.startsWith("/media/")}
                        sizes="(min-width: 1200px) 30vw, (min-width: 640px) 45vw, 90vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                    <div className="absolute left-3 top-3">
                      <Badge tone="gold">{post.category}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="font-serif text-lg font-semibold leading-snug text-rz-navy group-hover:text-rz-maroon">
                      {post.title}
                    </h2>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-rz-muted">{post.excerpt}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rz-border pt-3 text-xs text-rz-muted">
                      <span>{post.authorName}</span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(post.publishedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {post.readTimeMinutes} min read
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Container>
      </Section>
    </>
  );
}
