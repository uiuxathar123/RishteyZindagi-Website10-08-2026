import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Accordion } from "@/components/ui/Accordion";
import { MatchmakingOfferClient } from "@/components/matchmaking/MatchmakingOfferClient";

export const metadata: Metadata = {
  title: "Personal Matchmaking",
  description: "A RishteyZindagi matchmaking specialist reviews your profile and preferences and shares hand-picked profile suggestions with you.",
  alternates: { canonical: "/personal-matchmaking" },
};

const FAQ = [
  {
    question: "How does Personal Matchmaking work?",
    answer:
      "After your payment is verified, our matchmaking team reviews your profile and partner preferences, combines our compatibility scoring with their own judgement, and shares suggested profiles in your dashboard.",
  },
  {
    question: "Does a suggestion mean we are matched?",
    answer:
      "No. A suggestion is an introduction. To connect, you send an interest as usual; you can chat once the interest is accepted on both sides.",
  },
  {
    question: "Who can see that I use this service?",
    answer:
      "Nobody else. Suggested members are not told who they were suggested to, and only profiles that are already visible to members can be suggested.",
  },
  {
    question: "Can I stop my own profile being suggested?",
    answer: "Yes. In Dashboard → Personal Matchmaking you can opt out of being suggested to other members at any time.",
  },
];

export default function PersonalMatchmakingPage() {
  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Personal Matchmaking</p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">A matchmaker on your side</h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            Tell us what matters to you. A dedicated matchmaking specialist reviews your profile and shares hand-picked suggestions with you.
          </p>
        </Container>
      </Section>
      <Section className="!pt-0">
        <Container className="max-w-2xl">
          <MatchmakingOfferClient />
        </Container>
      </Section>
      <Section className="bg-rz-peach/40">
        <Container className="max-w-2xl">
          <Accordion items={FAQ} />
        </Container>
      </Section>
    </>
  );
}
