import { Container } from "@/components/ui/Container";
import { Flag, Lock, ShieldCheck, UserCheck } from "lucide-react";

/**
 * Trust points are statements about how the product works (all backed by
 * real features: OTP-verified sign-up, staff profile verification, photos
 * hidden from visitors, block / report tools). Deliberately no counts,
 * ratings or percentages — the platform publishes no such figures.
 */
const POINTS = [
  { icon: ShieldCheck, title: "OTP-verified sign-up", detail: "Every account confirms its contact first" },
  { icon: UserCheck, title: "Profile verification", detail: "Profiles can be reviewed by our team" },
  { icon: Lock, title: "Photos stay private", detail: "Visitors see a blurred preview only" },
  { icon: Flag, title: "Block & report tools", detail: "Concerns are reviewed by our safety team" },
];

export function TrustStrip() {
  return (
    <div className="bg-rz-navy text-white">
      <Container className="grid grid-cols-1 gap-6 py-10 sm:grid-cols-2 md:grid-cols-4 md:gap-8">
        {POINTS.map(({ icon: Icon, title, detail }) => (
          <div key={title} className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-rz-gold-soft">
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div>
              <p className="font-serif text-base font-bold leading-tight">{title}</p>
              <p className="mt-1 text-xs text-white/60">{detail}</p>
            </div>
          </div>
        ))}
      </Container>
    </div>
  );
}
