import type { Metadata } from "next";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { StarRating } from "@/components/ui/StarRating";
import { TESTIMONIALS } from "@/data/testimonials";
import { Quote } from "lucide-react";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Success Stories",
  description: "Illustrative sample stories showing what a happy ending on RishteyZindagi can look like.",
  alternates: { canonical: "/success-stories" },
};

export default function SuccessStoriesPage() {
  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">
            Sample Stories
          </p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            What a happy ending can look like
          </h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            These are illustrative sample stories written for this preview, with stock photos — they are
            not reviews from real members. Real member stories will appear here once we have them.
          </p>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure key={t.names} className="flex min-w-0 flex-col rounded-xl border border-rz-border bg-white p-6 shadow-card-sm">
                <Quote className="mb-3 h-6 w-6 text-rz-gold" fill="currentColor" strokeWidth={0} />
                <blockquote className="mb-5 flex-1 text-[14.5px] leading-relaxed text-rz-text">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="flex items-center gap-3 border-t border-rz-border pt-4">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full">
                    <Image src={t.photo} alt="" fill sizes="44px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-rz-navy">{t.names}</p>
                    <p className="truncate text-xs text-rz-muted">{t.location} · {t.year} · sample</p>
                  </div>
                  <StarRating value={t.rating} size={13} />
                </figcaption>
              </figure>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-rz-navy text-white">
        <Container className="flex flex-col items-center gap-5 text-center">
          <h2 className="max-w-lg font-serif text-2xl font-bold md:text-3xl">
            Found your match on RishteyZindagi?
          </h2>
          <p className="max-w-md text-sm text-white/70">
            We&apos;d love to feature your story. Share it with our team and, with your permission,
            we&apos;ll add it here.
          </p>
          <ButtonLink href="/contact" variant="outline" className="!border-white !bg-transparent !text-white hover:!bg-white/10">
            Share Your Story
          </ButtonLink>
        </Container>
      </Section>
    </>
  );
}
