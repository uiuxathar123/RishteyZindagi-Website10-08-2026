import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { blogService } from "@/services/blogService";
import { CalendarDays, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical, warm advice on matrimony, NRI matchmaking, family involvement and safe searching — from the RishteyZindagi editorial team.",
  alternates: { canonical: "/blog" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function BlogIndexPage() {
  const posts = await blogService.list();

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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="rz-focus group flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white transition-shadow duration-200 hover:shadow-card-sm"
              >
                <div className="relative aspect-[3/2] w-full overflow-hidden bg-rz-peach">
                  <Image
                    src={post.coverImage}
                    alt={post.coverImageAlt}
                    fill
                    sizes="(min-width: 1200px) 30vw, (min-width: 640px) 45vw, 90vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
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
                    <span>{post.author}</span>
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
        </Container>
      </Section>
    </>
  );
}
