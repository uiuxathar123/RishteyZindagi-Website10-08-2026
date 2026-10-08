import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { EyeOff, Flag, Fingerprint, ShieldAlert } from "lucide-react";

const PILLARS = [
  { icon: Fingerprint, title: "ID-verified profiles", description: "Every member is verified before their profile becomes visible in search." },
  { icon: EyeOff, title: "Privacy controls", description: "Decide who can view your photos, contact details and profile at all." },
  { icon: Flag, title: "Report & block", description: "Report a concern in two taps — our safety team reviews every case." },
  { icon: ShieldAlert, title: "Zero-tolerance policy", description: "Accounts that breach our community guidelines are suspended promptly." },
];

export function SafetyTrust() {
  return (
    <Section className="bg-rz-peach/40">
      <Container>
        <SectionHeading
          eyebrow="Safety & Trust"
          title="Your safety is the foundation, not an afterthought"
          description="Matrimony is deeply personal — our safety systems are built to protect that trust at every step."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-lg bg-white p-6 shadow-card-sm">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rz-champagne text-rz-gold-deep">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h3 className="mb-2 font-serif text-base font-semibold text-rz-navy">{title}</h3>
              <p className="text-sm leading-relaxed text-rz-muted">{description}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <ButtonLink href="/safety" variant="outline">
            Visit the Safety Centre
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
