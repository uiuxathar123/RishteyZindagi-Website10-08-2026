"use client";

import { Container } from "@/components/ui/Container";
import { HeaderActions, useHeaderSession } from "./HeaderAuth";
import { cn } from "@/lib/utils";
import { Heart, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Order matches the global design spec's primary navigation exactly
// (Home, How It Works, Search, Membership, Success Stories, Safety,
// About). Blog is real, substantive content built in Phase 2 — it's kept
// as an additional item after the spec's list rather than removed, since
// hiding already-built content isn't something the brief asked for.
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/search", label: "Search" },
  { href: "/membership", label: "Membership" },
  { href: "/success-stories", label: "Success Stories" },
  { href: "/safety", label: "Safety" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
];

export function Logo({ variant = "default" }: { variant?: "default" | "inverted" }) {
  const inverted = variant === "inverted";
  return (
    <Link href="/" className="flex shrink-0 items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-rz-gold bg-[#FFF3DE]">
        <Heart className="h-4 w-4 fill-rz-maroon text-rz-maroon" strokeWidth={0} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-serif text-[20px] font-bold">
          <span className={inverted ? "text-white" : "text-rz-navy"}>Rishtey</span>
          <span className={inverted ? "text-rz-gold-soft" : "text-rz-maroon"}>Zindagi</span>
          <span className={inverted ? "text-white" : "text-rz-navy"}>.com</span>
        </span>
        <span className={cn("hidden text-[11px] sm:block", inverted ? "text-white/60" : "text-rz-muted")}>
          Find a meaningful connection. Build a beautiful future.
        </span>
      </span>
    </Link>
  );
}

/**
 * Public marketing header. The page itself is static; the right-hand actions
 * are a client island (see HeaderAuth) that asks the backend whether someone
 * is signed in — Dashboard / Log out for a member, Login / Create Profile
 * for a visitor.
 */
export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const { session, logout, loggingOut } = useHeaderSession();
  const drawerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstDrawerLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Body scroll lock + Escape-to-close + focus-first-link while the
  // mobile drawer is open. Click-outside is handled separately below.
  useEffect(() => {
    if (!drawerOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstDrawerLinkRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        drawerRef.current &&
        !drawerRef.current.contains(target) &&
        toggleRef.current &&
        !toggleRef.current.contains(target)
      ) {
        setDrawerOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [drawerOpen]);

  return (
    <header
      className={cn(
        "sticky top-0 z-header bg-white transition-shadow duration-200",
        scrolled ? "shadow-card-sm" : "shadow-none border-b border-rz-navy/5"
      )}
    >
      <Container className="flex h-[76px] items-center justify-between gap-6">
        <Logo />

        <nav aria-label="Primary" className="hidden flex-1 items-center justify-center gap-7 xl:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rz-focus relative py-1.5 text-[14.5px] font-medium text-rz-text transition-colors hover:text-rz-maroon",
                  active && "font-semibold text-rz-maroon"
                )}
              >
                {link.label}
                {active && (
                  <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-rz-maroon" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 xl:flex">
          <HeaderActions session={session} onLogout={logout} loggingOut={loggingOut} layout="inline" />
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="rz-focus flex h-10 w-10 items-center justify-center rounded-full text-rz-navy xl:hidden"
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          aria-controls="rz-mobile-drawer"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          {drawerOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </Container>

      {/* Mobile drawer — inline disclosure panel (not a modal), so it
          collapses via max-height rather than an overlay. Reduced motion
          is handled globally (globals.css zeroes transition-duration
          under prefers-reduced-motion), so no extra handling is needed
          here beyond that shared rule. */}
      <div
        ref={drawerRef}
        id="rz-mobile-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="Mobile navigation"
        className={cn(
          "overflow-hidden bg-white transition-[max-height] duration-300 ease-rz xl:hidden",
          drawerOpen ? "max-h-[520px] border-t border-rz-border" : "max-h-0"
        )}
      >
        <Container className="flex flex-col gap-1 py-4">
          {NAV_LINKS.map((link, i) => (
            <Link
              key={link.href}
              ref={i === 0 ? firstDrawerLinkRef : undefined}
              href={link.href}
              className={cn(
                "rz-focus rounded-md px-3 py-3 text-[15px] font-medium text-rz-text hover:bg-rz-peach/60",
                pathname === link.href && "text-rz-maroon"
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-3 px-3 pb-2">
            <HeaderActions session={session} onLogout={logout} loggingOut={loggingOut} layout="stacked" />
          </div>
        </Container>
      </div>
    </header>
  );
}
