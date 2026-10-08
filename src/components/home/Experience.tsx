import { Container, Section } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Eye, Lock, MessagesSquare, UserCheck } from "lucide-react";

const POINTS = [
  { icon: UserCheck, title: "Handpicked recommendations", description: "Matches ranked by real compatibility, not just recency." },
  { icon: Eye, title: "Full control over visibility", description: "Choose exactly who can see your profile and contact details." },
  { icon: Lock, title: "Private by default", description: "Photos and contact info stay protected until you choose to share." },
  { icon: MessagesSquare, title: "Guided conversations", description: "Icebreaker prompts that make starting a conversation easy." },
];

export function Experience() {
  return (
    <Section className="bg-white">
      <Container className="grid items-center gap-12 lg:grid-cols-2">
        <div className="relative">
          <div className="aspect-[4/5] w-full max-w-md overflow-hidden rounded-xl bg-rz-peach shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.pexels.com/photos/7580948/pexels-photo-7580948.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop"
              alt="A member reviewing her matrimonial profile on a laptop."
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="absolute -bottom-6 -right-4 hidden w-56 rounded-lg border border-rz-border bg-white p-4 shadow-card sm:block">
            <p className="font-serif text-lg font-bold text-rz-maroon">See why it matches</p>
            <p className="text-xs text-rz-muted">Every recommendation shows a compatibility breakdown, category by category.</p>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">
            The RishteyZindagi Experience
          </p>
          <h2 className="mb-4 font-serif text-3xl font-bold text-rz-navy md:text-4xl">
            A calmer, more considered way to search for a life partner
          </h2>
          <p className="mb-8 text-[15.5px] leading-relaxed text-rz-muted">
            No swiping, no noise. Every recommendation is grounded in the details that matter most to
            Indian and NRI families — community, compatibility, and character.
          </p>

          <ul className="space-y-5">
            {POINTS.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
                  <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="font-semibold text-rz-navy">{title}</p>
                  <p className="text-sm text-rz-muted">{description}</p>
                </div>
              </li>
            ))}
          </ul>

          <ButtonLink href="/how-it-works" variant="outline" className="mt-8">
            Learn how it works
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
