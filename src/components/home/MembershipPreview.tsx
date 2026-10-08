import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PlansCatalog } from "@/components/membership/PlansCatalog";
import { ButtonLink } from "@/components/ui/Button";

export function MembershipPreview() {
  return (
    <Section className="bg-white">
      <Container>
        <SectionHeading
          eyebrow="Membership"
          title="Plans for every stage of your search"
          description="Prices shown in INR for India. Gulf and international pricing in USD is on the Membership page."
        />
        <PlansCatalog fixedCurrency="INR" />
        <div className="mt-10 text-center">
          <ButtonLink href="/membership" variant="link">
            Compare all plan features →
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
