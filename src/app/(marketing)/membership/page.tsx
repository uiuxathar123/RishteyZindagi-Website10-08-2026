import type { Metadata } from "next";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PlansCatalog } from "@/components/membership/PlansCatalog";
import { Accordion } from "@/components/ui/Accordion";
import { getCurrentMembershipSummary } from "@/components/membership/currentMembership.server";

export const metadata: Metadata = {
  title: "Membership Plans",
  description: "Compare RishteyZindagi membership plans and pricing for India and Gulf members.",
  alternates: { canonical: "/membership" },
};

// Reads the session cookie to highlight the member's current plan.
export const dynamic = "force-dynamic";

const BILLING_FAQ = [
  {
    question: "Which payment methods are supported?",
    answer:
      "The available payment options depend on the payment gateway configured on our servers. If online payments are not set up, checkout will say so clearly and nothing is charged.",
  },
  {
    question: "Is my membership activated immediately after I pay?",
    answer:
      "Your membership activates only once the payment is verified on our servers. You will see the verified result on the confirmation screen, whether it succeeded, failed or is still pending.",
  },
  {
    question: "Can I get an invoice for my payment?",
    answer:
      "Yes. Every verified payment generates an invoice that you can download as a PDF from Dashboard → Membership.",
  },
  {
    question: "What happens if I don't renew?",
    answer:
      "Features that need an active membership, such as sending interests and chat, pause until you renew. You can renew or upgrade at any time from your dashboard.",
  },
];

export default async function MembershipPage() {
  const { current } = await getCurrentMembershipSummary();

  return (
    <>
      <Section className="bg-rz-cream !pb-10">
        <Container className="max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Membership</p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            Plans for every stage of your search
          </h1>
          <p className="text-[15.5px] leading-relaxed text-rz-muted">
            Plans are priced in INR for India and USD for Gulf and international members. Renew or upgrade any
            time from your dashboard.
          </p>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          <PlansCatalog showComparison current={current} />
        </Container>
      </Section>

      <Section className="bg-rz-peach/40">
        <Container className="max-w-2xl">
          <SectionHeading title="Billing questions" />
          <Accordion items={BILLING_FAQ} />
        </Container>
      </Section>
    </>
  );
}
