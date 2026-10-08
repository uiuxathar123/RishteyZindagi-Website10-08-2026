import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { BLOG_POSTS } from "@/data/blogPosts";
import { blogService } from "@/services/blogService";
import { CalendarDays, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface BlogPostPageProps {
  params: { slug: string };
}

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const post = await blogService.getBySlug(params.slug);
  if (!post) return { title: "Article Not Found" };

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      images: [{ url: post.coverImage }],
    },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const post = await blogService.getBySlug(params.slug);
  if (!post) notFound();

  const related = await blogService.related(post.slug, 3);

  return (
    <>
      <div className="relative h-[280px] w-full overflow-hidden bg-rz-peach md:h-[380px]">
        <Image
          src={post.coverImage}
          alt={post.coverImageAlt}
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-rz-navy-dark/70 via-rz-navy-dark/10 to-transparent" />
      </div>

      <Section className="!pt-10">
        <Container className="max-w-2xl">
          <Badge tone="navy">{post.category}</Badge>
          <h1 className="mt-4 font-serif text-3xl font-bold leading-tight text-rz-navy md:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-rz-border pb-6 text-sm text-rz-muted">
            <span className="font-medium text-rz-text">{post.author}</span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {formatDate(post.publishedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {post.readTimeMinutes} min read
            </span>
          </div>

          <div className="mt-8 space-y-5">
            {post.content.map((paragraph, i) => (
              <p key={i} className="text-[16px] leading-[1.85] text-rz-text">
                {paragraph}
              </p>
            ))}
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
                    <Image
                      src={r.coverImage}
                      alt={r.coverImageAlt}
                      fill
                      sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="font-serif text-base font-semibold leading-snug text-rz-navy group-hover:text-rz-maroon">
                      {r.title}
                    </h3>
                    <p className="mt-2 text-xs text-rz-muted">
                      {r.readTimeMinutes} min read · {formatDate(r.publishedAt)}
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
