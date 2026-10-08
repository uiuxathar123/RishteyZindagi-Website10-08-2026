import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { TESTIMONIALS } from "@/data/testimonials";
import { Quote } from "lucide-react";
import Image from "next/image";

export function Testimonials() {
  return (
    <Section className="bg-rz-cream">
      <Container>
        <SectionHeading
          eyebrow="Sample Stories"
          title="What a happy ending can look like"
          description="These are illustrative sample stories written for this preview, with stock photos — they are not reviews from real members."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.slice(0, 3).map((t) => (
            <figure key={t.names} className="flex flex-col rounded-xl border border-rz-border bg-white p-6 shadow-card-sm">
              <Quote className="mb-3 h-6 w-6 text-rz-gold" fill="currentColor" strokeWidth={0} />
              <blockquote className="mb-5 flex-1 text-[14.5px] leading-relaxed text-rz-text">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="flex items-center gap-3 border-t border-rz-border pt-4">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full">
                  <Image src={t.photo} alt="" fill sizes="44px" className="object-cover" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-rz-navy">{t.names}</p>
                  <p className="text-xs text-rz-muted">{t.location} · {t.year} · sample</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-10 text-center">
          <ButtonLink href="/success-stories" variant="link">
            See more sample stories →
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
