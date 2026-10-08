import type { Metadata } from "next";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Heart, ShieldCheck, Sparkles, Users2 } from "lucide-react";

export const metadata: Metadata = {
  title: "About Us",
  description: "RishteyZindagi.com — a premium Indian and NRI matrimonial platform, celebrating 10 years of bringing hearts together.",
  alternates: { canonical: "/about" },
};

const VALUES = [
  { icon: ShieldCheck, title: "Trust first", description: "Every decision we make is weighed against one question: does this make families trust us more?" },
  { icon: Users2, title: "Family, not just individuals", description: "We design for how Indian and NRI matrimony actually works — as a family journey, not a solo swipe." },
  { icon: Sparkles, title: "Quality over volume", description: "We'd rather show you five well-matched profiles than fifty irrelevant ones." },
  { icon: Heart, title: "Respect and privacy", description: "Your information is yours. We ask before we share, and we protect what you don't." },
];

const TIMELINE = [
  { year: "2016", text: "RishteyZindagi launches in India, focused on verified Hindu and Muslim matrimony." },
  { year: "2018", text: "Expansion to the Gulf — UAE, Saudi Arabia, Qatar and Kuwait — to serve NRI families." },
  { year: "2020", text: "Smart Matching launches, ranking recommendations by real compatibility, not recency." },
  { year: "2023", text: "100,000+ verified profiles milestone reached across India and the Gulf." },
  { year: "2026", text: "Celebrating 10 years and thousands of successful matches — and still growing." },
];

export default function AboutPage() {
  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">About Us</p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            Find a meaningful connection. Build a beautiful future.
          </h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            RishteyZindagi.com is a premium matrimonial platform serving Indian and NRI families across
            India, UAE, Saudi Arabia, Qatar and Kuwait — built on verification, privacy and genuine
            compatibility.
          </p>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-lg border border-rz-border bg-white p-6">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h2 className="mb-2 font-serif text-base font-semibold text-rz-navy">{title}</h2>
                <p className="text-sm leading-relaxed text-rz-muted">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-white">
        <Container className="max-w-2xl">
          <SectionHeading eyebrow="Our Journey" title="A decade of bringing hearts together" />
          <ol className="relative space-y-8 border-l border-rz-border pl-8">
            {TIMELINE.map((item) => (
              <li key={item.year} className="relative">
                <span className="absolute -left-[38px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-rz-cream bg-rz-maroon" />
                <p className="font-serif text-lg font-bold text-rz-navy">{item.year}</p>
                <p className="mt-1 text-sm leading-relaxed text-rz-muted">{item.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section className="bg-rz-navy text-white">
        <Container className="flex flex-col items-center gap-5 text-center">
          <h2 className="max-w-lg font-serif text-2xl font-bold md:text-3xl">
            Be part of the next chapter
          </h2>
          <ButtonLink href="/signup" size="lg" className="bg-white !text-rz-maroon hover:!bg-rz-cream">
            Create Your Free Profile
          </ButtonLink>
        </Container>
      </Section>
    </>
  );
}
