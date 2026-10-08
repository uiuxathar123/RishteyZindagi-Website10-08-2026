import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Accordion } from "@/components/ui/Accordion";
import { ButtonLink } from "@/components/ui/Button";
import { FAQS } from "@/data/faqs";

export function FAQPreview() {
  return (
    <Section className="bg-white">
      <Container className="max-w-3xl">
        <SectionHeading eyebrow="Questions" title="Frequently Asked Questions" />
        <Accordion items={FAQS.slice(0, 4)} />
        <div className="mt-8 text-center">
          <ButtonLink href="/faq" variant="link">
            View all FAQs →
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
