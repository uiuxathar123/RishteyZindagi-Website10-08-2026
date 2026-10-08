import type { MembershipPlan } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Check, Minus } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { featureKeysOf, featureLabel, formatDuration } from "./planUtils";

/**
 * One backend plan. `state` is a display hint only (the backend enforces
 * what can actually be bought): "current" = the member's active plan,
 * "lower" = a lower tier than the member's active plan (the backend
 * rejects that checkout with a 409 while the membership is active).
 */
export function PlanCard({
  plan,
  allFeatureKeys,
  state,
}: {
  plan: MembershipPlan;
  allFeatureKeys?: string[];
  state?: "current" | "lower";
}) {
  const keys = allFeatureKeys ?? featureKeysOf([plan]);
  const duration = formatDuration(plan.durationDays);
  const href = `/membership/checkout?plan=${encodeURIComponent(plan.code)}`;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-xl border bg-white p-6",
        state === "current" ? "border-rz-maroon shadow-card" : "border-rz-border shadow-card-sm"
      )}
    >
      {state === "current" && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-rz-maroon px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          Your current plan
        </span>
      )}
      <p className="font-serif text-lg font-semibold text-rz-navy">{plan.name}</p>
      <p className="mb-4 text-xs text-rz-muted">{duration} access</p>
      <p className="mb-5">
        <span className="font-serif text-3xl font-bold text-rz-navy">
          {formatMoney(plan.priceInSmallestUnit, plan.currency)}
        </span>
        <span className="text-sm text-rz-muted"> / {duration}</span>
      </p>
      <ul className="mb-6 flex-1 space-y-2.5">
        {keys.map((k) => {
          const on = plan.features?.[k] === true;
          return (
            <li
              key={k}
              className={cn("flex items-start gap-2 text-[13.5px]", on ? "text-rz-text" : "text-rz-muted/70")}
            >
              {on ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-rz-success" strokeWidth={2.5} aria-hidden />
              ) : (
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-rz-border" strokeWidth={2.5} aria-hidden />
              )}
              <span>
                {featureLabel(k)}
                {!on && <span className="sr-only"> (not included)</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {state === "lower" ? (
        <Badge tone="neutral" className="justify-center whitespace-normal py-2 text-center">
          Not available while a higher plan is active
        </Badge>
      ) : (
        <ButtonLink href={href} variant={state === "current" ? "primary" : "outline"} fullWidth>
          {state === "current" ? `Renew ${plan.name}` : `Choose ${plan.name}`}
        </ButtonLink>
      )}
    </div>
  );
}
