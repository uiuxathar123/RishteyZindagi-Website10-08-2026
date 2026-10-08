import { Container, Section } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";

export function FinalCTA() {
  return (
    <Section className="bg-gradient-to-br from-rz-maroon to-rz-maroon-dark text-white">
      <Container className="flex flex-col items-center gap-6 text-center">
        <h2 className="max-w-xl font-serif text-3xl font-bold md:text-4xl">
          Your story could be the next one we celebrate.
        </h2>
        <p className="max-w-lg text-[15.5px] text-white/80">
          Trust RishteyZindagi with the most important search of your life. Creating a profile takes just a
          few minutes.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signup" variant="primary" size="lg" className="bg-white !text-rz-maroon hover:!bg-rz-cream">
            Create Your Free Profile
          </ButtonLink>
          <ButtonLink href="/how-it-works" variant="outline" size="lg" className="!border-white !bg-transparent !text-white hover:!bg-white/10">
            See How It Works
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
