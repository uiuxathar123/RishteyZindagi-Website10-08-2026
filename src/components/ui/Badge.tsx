import { cn } from "@/lib/utils";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { ReactNode } from "react";

type Tone = "navy" | "maroon" | "gold" | "success" | "neutral";

const toneClasses: Record<Tone, string> = {
  navy: "bg-rz-navy/8 text-rz-navy",
  maroon: "bg-rz-maroon/8 text-rz-maroon",
  gold: "bg-rz-champagne text-rz-gold-deep",
  success: "bg-rz-success/10 text-rz-success",
  neutral: "bg-rz-border/60 text-rz-muted",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** The small "Verified" checkmark badge used on profile photos and cards
 * throughout the product — kept as one component so the mark stays
 * pixel-identical everywhere it appears. */
/** Exact label required by the product: "Company Verified". The tooltip states what it does NOT mean. */
export const COMPANY_VERIFIED_TOOLTIP =
  "Company Verified: this profile was reviewed and approved by the RishteyZindagi team. It is not a guarantee of compatibility, character or a successful marriage.";

export function CompanyVerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      title={COMPANY_VERIFIED_TOOLTIP}
      aria-label={COMPANY_VERIFIED_TOOLTIP}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-rz-navy px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm",
        className
      )}
    >
      <BadgeCheck className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      <span aria-hidden>Company Verified</span>
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      title="Verified profile"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-rz-success px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm",
        className
      )}
    >
      <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
      Verified
    </span>
  );
}

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rz-muted">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          online ? "bg-rz-success" : "bg-rz-border"
        )}
      />
      {online ? "Online now" : "Offline"}
    </span>
  );
}
