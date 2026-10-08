import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/Container";
import { Accordion } from "@/components/ui/Accordion";
import { FAQS } from "@/data/faqs";

export const metadata: Metadata = {
  title: "FAQs",
  description: "Answers to common questions about profiles, matching, membership and safety on RishteyZindagi.",
  alternates: { canonical: "/faq" },
};

const CATEGORIES = ["Getting Started", "Matching", "Membership & Billing", "Safety & Privacy"] as const;

export default function FAQPage() {
  return (
    <Section>
      <Container className="max-w-3xl">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Questions</p>
          <h1 className="font-serif text-4xl font-bold text-rz-navy md:text-5xl">
            Frequently Asked Questions
          </h1>
        </div>

        <div className="space-y-12">
          {CATEGORIES.map((category) => {
            const items = FAQS.filter((f) => f.category === category);
            if (!items.length) return null;
            return (
              <div key={category}>
                <h2 className="mb-4 font-serif text-xl font-semibold text-rz-navy">{category}</h2>
                <Accordion items={items} />
              </div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
