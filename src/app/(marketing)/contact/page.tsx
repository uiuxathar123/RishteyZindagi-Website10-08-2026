import type { Metadata } from "next";
import Link from "next/link";
import { Container, Section } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { HelpCircle, Mail, Phone, ShieldAlert, UserCog } from "lucide-react";
import { ContactForm } from "@/components/contact/ContactForm";
import { getPublicSupportContact } from "@/server/modules/content/content.service";

// Support details are edited by an admin at runtime, so this page is rendered per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "How to get help with RishteyZindagi — account support, safety concerns and answers to common questions.",
  alternates: { canonical: "/contact" },
};

// Only details that are actually configured are ever shown: an admin enters them under Admin → Support Inbox
// (stored in platform settings); NEXT_PUBLIC_SUPPORT_EMAIL remains a fallback for the e-mail address.

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

export default async function ContactPage() {
  let support = { email: "", phone: "", hours: "" };
  try {
    support = await getPublicSupportContact();
  } catch {
    /* database unreachable: fall back to the build-time address only */
  }
  const SUPPORT_EMAIL = support.email || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "";
  return (
    <Section>
      <Container className="max-w-3xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">Contact Us</p>
        <h1 className="mb-4 font-serif text-3xl font-bold text-rz-navy md:text-4xl">We&apos;re here to help</h1>
        <p className="mb-8 text-[15.5px] leading-relaxed text-rz-muted">
          Write to us below, or use one of the quick options.
        </p>

        {(SUPPORT_EMAIL || support.phone) && (
          <div className="mb-8 grid gap-3 sm:grid-cols-2" data-testid="support-details">
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}`} className="rz-focus flex items-center gap-4 rounded-lg border border-rz-border bg-white p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-navy"><Mail className="h-5 w-5" strokeWidth={1.8} /></span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-rz-muted">Email us</span>
                  <span className="block break-all text-sm font-medium text-rz-navy">{SUPPORT_EMAIL}</span>
                </span>
              </a>
            )}
            {support.phone && (
              <a href={`tel:${support.phone.replace(/[^0-9+]/g, "")}`} className="rz-focus flex items-center gap-4 rounded-lg border border-rz-border bg-white p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-navy"><Phone className="h-5 w-5" strokeWidth={1.8} /></span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-rz-muted">Call us</span>
                  <span className="block text-sm font-medium text-rz-navy">{support.phone}</span>
                  {support.hours && <span className="block text-xs text-rz-muted">{support.hours}</span>}
                </span>
              </a>
            )}
          </div>
        )}

        <div className="mb-10">
          <h2 className="mb-3 font-serif text-xl font-semibold text-rz-navy">Send us a message</h2>
          <ContactForm />
        </div>

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
