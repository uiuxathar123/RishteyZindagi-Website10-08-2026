import type { Metadata } from "next";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Accordion } from "@/components/ui/Accordion";
import {
  BadgeCheck,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sliders,
  UserPlus,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "See exactly how RishteyZindagi takes you from creating a profile to a verified, compatibility-ranked match — step by step.",
  alternates: { canonical: "/how-it-works" },
};

const STEPS = [
  {
    icon: UserPlus,
    title: "1. Create your profile",
    description:
      "Tell us about yourself — background, education, profession, family and lifestyle. Most members finish in under 10 minutes, and you can always come back and add more later.",
  },
  {
    icon: ShieldCheck,
    title: "2. Get verified",
    description:
      "Our verification team reviews every new profile before it appears in search — checking photos and key details so every member you meet is genuine.",
  },
  {
    icon: Sliders,
    title: "3. Set your partner preferences",
    description:
      "Tell us what matters most to you — age range, religion, location, education, lifestyle. These preferences drive your recommendations more than anything else.",
  },
  {
    icon: Users,
    title: "4. Discover your matches",
    description:
      "Your homepage fills with profiles ranked by real compatibility, shown as a clear match percentage with a category-by-category breakdown.",
  },
  {
    icon: Heart,
    title: "5. Express interest",
    description:
      "Like a profile, or send a direct interest. When it's mutual, you're both notified instantly and chat unlocks automatically.",
  },
  {
    icon: MessageCircle,
    title: "6. Start the conversation",
    description:
      "Take things at your own pace in a private, respectful chat — with full control over what you share and when.",
  },
];

const FAQ = [
  { question: "How long does verification take?", answer: "Most profiles are reviewed within 24–48 hours of submission." },
  { question: "Can I change my partner preferences later?", answer: "Yes, at any time from Settings → Partner Preferences — your recommendations update immediately." },
  { question: "Do I need a paid membership to see matches?", answer: "No — recommendations and match percentages are visible on a free profile. A membership is needed to chat and send unlimited interests." },
];

export default function HowItWorksPage() {
  return (
    <>
      <Section className="bg-rz-cream !pb-0">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">
            How It Works
          </p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            From a new profile to a real connection
          </h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            RishteyZindagi is built around one idea: matrimony deserves a careful, guided process — not
            an endless swipe. Here&apos;s exactly what happens at each step.
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
            {STEPS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-lg border border-rz-border bg-white p-6">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h2 className="mb-2 font-serif text-lg font-semibold text-rz-navy">{title}</h2>
                <p className="text-sm leading-relaxed text-rz-muted">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-rz-navy text-white">
        <Container className="flex flex-col items-center gap-4 text-center">
          <BadgeCheck className="h-9 w-9 text-rz-gold-soft" strokeWidth={1.5} />
          <h2 className="max-w-lg font-serif text-2xl font-bold md:text-3xl">
            Every profile is verified before it ever reaches your search
          </h2>
          <p className="max-w-md text-sm text-white/70">
            That&apos;s the RishteyZindagi difference — you spend your time on real conversations, not
            filtering out fake profiles.
          </p>
          <ButtonLink href="/safety" variant="outline" className="mt-2 !border-white !bg-transparent !text-white hover:!bg-white/10">
            Read about our Safety Centre
          </ButtonLink>
        </Container>
      </Section>

      <Section>
        <Container className="max-w-2xl">
          <SectionHeading title="Common questions about the process" />
          <Accordion items={FAQ} />
        </Container>
      </Section>

      <Section className="bg-rz-peach/40 !pt-0">
        <Container className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-serif text-2xl font-bold text-rz-navy">Ready to begin?</h2>
          <ButtonLink href="/signup" size="lg">Create Your Free Profile</ButtonLink>
        </Container>
      </Section>
    </>
  );
}
