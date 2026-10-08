import { Container } from "@/components/ui/Container";
import { Logo } from "./Header";
import Link from "next/link";
import { BadgeCheck, Globe2, Lock, Mail, ShieldCheck, Smartphone } from "lucide-react";

// Column 2 — Quick Links. Order matches the global design spec exactly
// (Home … FAQ); Blog is appended after it for the same reason it's kept
// in the header nav — it's real, built content, not something the brief
// asked to remove.
const QUICK_LINKS = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/search", label: "Search" },
  { href: "/membership", label: "Membership" },
  { href: "/success-stories", label: "Success Stories" },
  { href: "/safety", label: "Safety" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];

// Column 3 — Matrimonial. Recommended Profiles and Partner Preferences
// are member-account features with no public equivalent, so they route
// to Sign Up rather than a page that doesn't exist. NRI Matrimony routes
// to unfiltered Search rather than a fake country value — the real
// search only filters on an exact country (India / UAE / Saudi Arabia /
// Qatar / Kuwait), there's no single "NRI" filter to link to honestly.
const MATRIMONIAL_LINKS = [
  { href: "/search", label: "Browse Profiles" },
  { href: "/signup", label: "Recommended Profiles" },
  { href: "/signup", label: "Partner Preferences" },
  { href: "/success-stories", label: "Success Stories" },
  { href: "/search?country=India", label: "India Matrimony" },
  { href: "/search", label: "NRI Matrimony" },
];

// Column 4 — Support.
const SUPPORT_LINKS = [
  { href: "/contact", label: "Contact Us" },
  { href: "/faq", label: "Help & Support" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund / Cancellation Policy" },
];

const TRUST_STRIP = [
  { icon: BadgeCheck, label: "Verified Profiles" },
  { icon: Lock, label: "Privacy Focused" },
  { icon: Globe2, label: "India + NRI Connections" },
  { icon: ShieldCheck, label: "Secure Platform" },
];

const LEGAL_LINKS = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms" },
  { href: "/refund-policy", label: "Refund Policy" },
];

// Only a support address that is actually configured is shown (build-time env).
// No placeholder phone number / email is ever displayed.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "";

export function Footer() {
  return (
    <footer className="border-t border-rz-border bg-rz-navy text-white/80">
      <Container className="grid gap-12 py-16 lg:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Logo variant="inverted" />
          {/* Logo's own tagline span is hidden below the sm breakpoint, so
              it's repeated here, always visible, to match the brief's
              brand-column spec. */}
          <p className="mt-4 text-sm font-medium text-white/70 sm:hidden">
            Find a meaningful connection. Build a beautiful future.
          </p>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/60">
            RishteyZindagi connects people across India and the world who are looking for
            meaningful, serious and compatible matrimonial relationships — serving families across
            India, UAE, Saudi Arabia, Qatar and Kuwait.
          </p>
        </div>

        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-rz-gold-soft">
            Quick Links
          </p>
          <ul className="space-y-2.5">
            {QUICK_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="rz-focus text-sm text-white/70 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-rz-gold-soft">
            Matrimonial
          </p>
          <ul className="space-y-2.5">
            {MATRIMONIAL_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="rz-focus text-sm text-white/70 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-rz-gold-soft">
            Support
          </p>
          <ul className="space-y-2.5">
            {SUPPORT_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="rz-focus text-sm text-white/70 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>

      {/* Trust strip — subtle, text + icon only, no cards or heavy styling. */}
      <div className="border-t border-white/10">
        <Container className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-6 sm:justify-between">
          {TRUST_STRIP.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2 text-xs font-medium text-white/60">
              <Icon className="h-4 w-4 text-rz-gold-soft" strokeWidth={1.8} />
              {label}
            </span>
          ))}
        </Container>
      </div>

      {/* App promotion — no real Play Store listing exists yet for this
          product (see README "What's intentionally still not in this
          phase"), so this deliberately does not render a clickable store
          badge or an invented URL — it's a plain "coming soon" notice. */}
      <div className="border-t border-white/10">
        <Container className="flex flex-col items-center justify-between gap-6 py-10 lg:flex-row">
          <div className="text-center lg:text-left">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-rz-gold-soft">
              RishteyZindagi App
            </p>
            <h3 className="font-serif text-xl font-semibold text-white md:text-2xl">
              Take RishteyZindagi with you.
            </h3>
            <p className="mt-1.5 text-sm text-white/60">
              Find meaningful connections wherever you are.
            </p>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-5 py-3 text-white/50"
            aria-label="Android app coming soon — not yet available"
          >
            <Smartphone className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-left">
              <span className="block text-[11px]">Android App</span>
              <span className="block text-sm font-semibold">Coming Soon</span>
            </span>
          </span>
        </Container>
      </div>

      <Container className="flex flex-col items-center justify-between gap-4 border-t border-white/10 py-6 text-xs text-white/50 lg:flex-row">
        <p>© 2016–{new Date().getFullYear()} RishteyZindagi.com. All rights reserved.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="rz-focus hover:text-white">
              {link.label}
            </Link>
          ))}
          {SUPPORT_EMAIL ? (
            <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-1.5 hover:text-white">
              <Mail className="h-3.5 w-3.5" /> {SUPPORT_EMAIL}
            </a>
          ) : (
            <Link href="/contact" className="rz-focus flex items-center gap-1.5 hover:text-white">
              <Mail className="h-3.5 w-3.5" /> Contact
            </Link>
          )}
        </div>
      </Container>
    </footer>
  );
}
