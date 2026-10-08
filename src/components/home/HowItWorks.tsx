import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { MessageCircle, ShieldCheck, UserPlus, Users } from "lucide-react";

const STEPS = [
  {
    icon: UserPlus,
    title: "Create Your Profile",
    description: "Share your details, family background and what you're looking for — takes about 10 minutes.",
  },
  {
    icon: ShieldCheck,
    title: "Get Verified",
    description: "Our team verifies every profile so you only ever connect with genuine, serious members.",
  },
  {
    icon: Users,
    title: "Discover Matches",
    description: "Receive smart, compatibility-ranked recommendations tailored to your partner preferences.",
  },
  {
    icon: MessageCircle,
    title: "Connect & Converse",
    description: "Send an interest, start a conversation, and take the next step at your own pace.",
  },
];

export function HowItWorks() {
  return (
    <Section className="bg-rz-cream">
      <Container>
        <SectionHeading
          eyebrow="Simple & Transparent"
          title="How RishteyZindagi Works"
          description="A guided, four-step path from a new profile to a meaningful connection — built around trust at every stage."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, description }, i) => (
            <div key={title} className="relative rounded-lg border border-rz-border bg-white p-6">
              <span className="absolute -top-3 left-6 flex h-7 w-7 items-center justify-center rounded-full bg-rz-maroon text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h3 className="mb-2 font-serif text-lg font-semibold text-rz-navy">{title}</h3>
              <p className="text-sm leading-relaxed text-rz-muted">{description}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
