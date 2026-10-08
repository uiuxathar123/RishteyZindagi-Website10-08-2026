import type { Metadata } from "next";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import {
  AlertOctagon,
  EyeOff,
  Fingerprint,
  Flag,
  Lock,
  MessageCircleWarning,
  ShieldAlert,
  UserX,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Safety Centre",
  description: "How RishteyZindagi verifies profiles, protects your privacy, and keeps the community safe.",
  alternates: { canonical: "/safety" },
};

const PILLARS = [
  { icon: Fingerprint, title: "Profile verification", description: "Every profile is reviewed by our team before it appears in search results or recommendations." },
  { icon: Lock, title: "Privacy by default", description: "Photos, phone numbers and email stay hidden until you choose to reveal them to a specific match." },
  { icon: EyeOff, title: "Visibility controls", description: "Hide your profile from specific members, or from search entirely, at any time in Settings." },
  { icon: Flag, title: "Report in two taps", description: "Report any profile or message directly from the conversation — our safety team reviews every case." },
  { icon: UserX, title: "Block anytime", description: "Blocking removes that profile from your search, recommendations, chat, likes and interests immediately." },
  { icon: ShieldAlert, title: "Warnings & suspension", description: "Accounts that breach our community guidelines receive a warning, or are suspended for repeated or serious violations." },
];

const TIPS = [
  "Never share OTPs, passwords, or banking details with anyone on the platform.",
  "Keep initial conversations on RishteyZindagi until you feel comfortable moving elsewhere.",
  "Video call before making any travel or financial commitments.",
  "Involve your family in the process, especially before meeting in person.",
  "Trust your instincts — report anything that feels inconsistent or pressuring.",
];

export default function SafetyPage() {
  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Safety & Trust</p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">Safety Centre</h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            Matrimony is deeply personal. Every part of RishteyZindagi is built to protect that trust —
            here&apos;s exactly how.
          </p>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-lg border border-rz-border bg-white p-6">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rz-champagne text-rz-gold-deep">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h2 className="mb-2 font-serif text-base font-semibold text-rz-navy">{title}</h2>
                <p className="text-sm leading-relaxed text-rz-muted">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-rz-peach/40">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <SectionHeading eyebrow="Stay Safe" title="A few things worth remembering" align="left" />
          </div>
          <ul className="space-y-4">
            {TIPS.map((tip) => (
              <li key={tip} className="flex items-start gap-3 rounded-lg bg-white p-4 text-sm text-rz-text shadow-card-sm">
                <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-rz-maroon" strokeWidth={2} />
                {tip}
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section className="bg-rz-navy text-white">
        <Container className="flex flex-col items-center gap-4 text-center">
          <MessageCircleWarning className="h-9 w-9 text-rz-gold-soft" strokeWidth={1.5} />
          <h2 className="max-w-lg font-serif text-2xl font-bold md:text-3xl">
            Something doesn&apos;t feel right?
          </h2>
          <p className="max-w-md text-sm text-white/70">
            Reach our safety team directly — every report is reviewed by a real person, usually within
            24 hours.
          </p>
          <ButtonLink href="/contact" variant="outline" className="!border-white !bg-transparent !text-white hover:!bg-white/10">
            Contact the Safety Team
          </ButtonLink>
        </Container>
      </Section>
    </>
  );
}
