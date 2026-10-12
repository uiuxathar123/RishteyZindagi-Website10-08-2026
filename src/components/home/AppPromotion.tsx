import { Container, Section } from "@/components/ui/Container";
import { Bell, MessageCircle, Search, Smartphone } from "lucide-react";

const FEATURES = [
  { icon: Search, label: "Search on the go" },
  { icon: MessageCircle, label: "Chat instantly" },
  { icon: Bell, label: "Real-time alerts" },
];

export function AppPromotion() {
  return (
    <Section className="bg-rz-navy text-white">
      <Container className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-gold-soft">
            RishteyZindagi App
          </p>
          <h2 className="mb-4 font-serif text-3xl font-bold md:text-4xl">
            Take your search with you, wherever you are
          </h2>
          <p className="mb-8 max-w-md text-[15.5px] leading-relaxed text-white/70">
            Get instant notifications for new matches, interests and messages with the RishteyZindagi
            Android app — designed for quick, on-the-go decisions without losing any of the desktop
            experience&apos;s depth.
          </p>
          <div className="mb-8 flex flex-wrap gap-5">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-2 text-sm text-white/80">
                <Icon className="h-4 w-4 text-rz-gold-soft" /> {label}
              </span>
            ))}
          </div>
          {/* B18: was an <a href="#"> Google Play button that went nowhere. There is no published app, so this is
              an honest, non-interactive notice rather than a control that looks clickable. */}
          <div
            role="note"
            aria-label="Android app coming soon — not yet available"
            className="inline-flex items-center gap-3 rounded-lg border border-white/20 bg-white/5 px-5 py-3"
          >
            <Smartphone className="h-7 w-7" strokeWidth={1.5} />
            <span className="text-left">
              <span className="block text-[11px] text-white/60">Android app</span>
              <span className="block text-sm font-semibold">Coming soon</span>
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[260px]">
          <div className="aspect-[9/19] w-full rounded-[2.2rem] border-4 border-white/15 bg-gradient-to-b from-rz-maroon/40 to-rz-navy p-3 shadow-2xl">
            <div className="flex h-full flex-col rounded-[1.6rem] bg-white p-4 text-rz-navy">
              <p className="mb-3 font-serif text-sm font-bold">RishteyZindagi</p>
              <div className="mb-2 h-20 rounded-lg bg-rz-peach" />
              <div className="mb-1.5 h-2.5 w-3/4 rounded bg-rz-border" />
              <div className="mb-4 h-2.5 w-1/2 rounded bg-rz-border" />
              <div className="grid flex-1 grid-cols-2 gap-2">
                <div className="rounded-lg bg-rz-cream" />
                <div className="rounded-lg bg-rz-cream" />
              </div>
              <div className="mt-3 flex justify-around border-t border-rz-border pt-2 text-[9px] text-rz-muted">
                <span>Home</span><span>Search</span><span>Matches</span><span>Profile</span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
