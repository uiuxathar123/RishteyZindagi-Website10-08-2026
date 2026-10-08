import type { Metadata } from "next";
import Link from "next/link";
import { Container, Section } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { HelpCircle, Mail, ShieldAlert, UserCog } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "How to get help with RishteyZindagi — account support, safety concerns and answers to common questions.",
  alternates: { canonical: "/contact" },
};

// Only an address that is actually configured is ever shown (NEXT_PUBLIC_SUPPORT_EMAIL).
// There is no contact-form endpoint on the backend, so there is no form either.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "";

const HELP_CARDS = [
  {
    icon: HelpCircle,
    title: "Common questions",
    text: "Membership, verification, privacy and how matching works.",
    href: "/faq",
    cta: "Read the FAQ",
  },
  {
    icon: ShieldAlert,
    title: "Safety concern about a member",
    text: "Members can report or block someone from their profile page. Reports are reviewed by our team.",
    href: "/safety",
    cta: "Safety guidance",
  },
  {
    icon: UserCog,
    title: "Account or password",
    text: "Locked out? Reset your password with a one-time code sent to your email.",
    href: "/forgot-password",
    cta: "Reset password",
  },
];

export default function ContactPage() {
  return (
    <Section>
      <Container className="max-w-3xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Contact Us</p>
        <h1 className="mb-4 font-serif text-3xl font-bold text-rz-navy md:text-4xl">We&apos;re here to help</h1>
        <p className="mb-8 text-[15.5px] leading-relaxed text-rz-muted">
          Here is the quickest way to get help today.
        </p>

        {SUPPORT_EMAIL ? (
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rz-focus mb-8 flex items-center gap-4 rounded-lg border border-rz-border bg-white p-4"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
              <Mail className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-rz-muted">Email us</span>
              <span className="block break-all text-sm font-medium text-rz-navy">{SUPPORT_EMAIL}</span>
            </span>
          </a>
        ) : (
          <div className="mb-8 rounded-lg border border-dashed border-rz-border bg-rz-cream/60 p-5 text-sm leading-relaxed text-rz-text">
            <p className="font-semibold text-rz-navy">Direct contact channels are coming soon.</p>
            <p className="mt-1 text-rz-muted">
              A support email, phone and contact form have not been published yet, so there is nothing to send a
              message to from this page. The options below work today.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {HELP_CARDS.map(({ icon: Icon, title, text, href, cta }) => (
            <div key={title} className="flex flex-col rounded-lg border border-rz-border bg-white p-5">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h2 className="font-serif text-base font-semibold text-rz-navy">{title}</h2>
              <p className="mt-1.5 flex-1 text-sm text-rz-muted">{text}</p>
              <Link href={href} className="rz-focus mt-4 text-sm font-semibold text-rz-maroon">
                {cta} →
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <ButtonLink href="/" variant="outline" size="md">
            Back to home
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
