"use client";

import { useMemo, useState } from "react";
import { Check, Minus, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { MembershipPlan } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/Container";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { PlanCard } from "./PlanCard";
import { currenciesOf, featureKeysOf, featureLabel, formatDuration, sortPlans, type CurrentMembershipSummary } from "./planUtils";

/**
 * The live plan catalogue (`GET /membership-plans`, public). Used by the
 * marketing page (with comparison table), the home page preview and the
 * dashboard upgrade section. Prices, durations and the feature matrix are
 * all generated from what the backend returns.
 */
export function PlansCatalog({
  showComparison = false,
  current,
  defaultCurrency,
  fixedCurrency,
  limitedNote,
}: {
  showComparison?: boolean;
  /** The member's ACTIVE plan, if any (highlight + downgrade hint). */
  current?: CurrentMembershipSummary | null;
  defaultCurrency?: string;
  /** Show only this currency and no switcher (home preview). */
  fixedCurrency?: string;
  limitedNote?: string;
}) {
  const { data, error, loading, reload } = useAsync<MembershipPlan[]>(
    async (signal) => {
      const res = await api.get<{ plans: MembershipPlan[] }>("/membership-plans", { signal });
      return res?.plans ?? [];
    },
    []
  );
  const [picked, setPicked] = useState<string | null>(null);

  const currencies = useMemo(() => (data ? currenciesOf(data) : []), [data]);
  const currency = useMemo(() => {
    if (fixedCurrency) return fixedCurrency;
    if (picked && currencies.includes(picked)) return picked;
    if (defaultCurrency && currencies.includes(defaultCurrency)) return defaultCurrency;
    if (current?.planId && data) {
      const cur = data.find((p) => p.id === current.planId);
      if (cur) return cur.currency;
    }
    return currencies[0] ?? "INR";
  }, [fixedCurrency, picked, currencies, defaultCurrency, current, data]);

  if (data === null && loading) {
    return (
      <div role="status" aria-label="Loading membership plans" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-80 w-full" />
        ))}
      </div>
    );
  }
  if (data === null && error) return <ApiErrorView error={error} onRetry={reload} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No membership plans available right now"
        description="Plans haven't been published yet. Please check back soon."
      />
    );
  }

  const plans = sortPlans(data.filter((p) => p.currency === currency));
  if (plans.length === 0) {
    return <EmptyState title={`No plans are priced in ${currency}`} description="Try another currency." />;
  }
  const keys = featureKeysOf(plans);
  const currentPlan = current ? data.find((p) => p.id === current.planId) : undefined;

  const stateFor = (p: MembershipPlan): "current" | "lower" | undefined => {
    if (!current) return undefined;
    if (current.planId === p.id) return "current";
    if (currentPlan && p.durationDays < currentPlan.durationDays) return "lower";
    return undefined;
  };

  return (
    <div>
      {!fixedCurrency && currencies.length > 1 && (
        <div className="mb-8 flex justify-center">
          <div role="group" aria-label="Currency" className="inline-flex rounded-full border border-rz-border bg-white p-1">
            {currencies.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === currency}
                onClick={() => setPicked(c)}
                className={cn(
                  "rz-focus rounded-full px-5 py-1.5 text-sm font-semibold transition-colors",
                  c === currency ? "bg-rz-maroon text-white" : "text-rz-muted hover:text-rz-maroon"
                )}
              >
                {c === "INR" ? "India · INR" : c === "USD" ? "Gulf · USD" : c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} allFeatureKeys={keys} state={stateFor(plan)} />
        ))}
      </div>
      {limitedNote && <p className="mt-6 text-center text-xs text-rz-muted">{limitedNote}</p>}

      {showComparison && (
        <div className="mt-16">
          <SectionHeading title="Compare plan features" />
          <div className="relative overflow-x-auto rounded-lg border border-rz-border bg-white">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Feature comparison of membership plans in {currency}</caption>
              <thead>
                <tr className="border-b border-rz-border bg-rz-cream text-left">
                  <th scope="col" className="p-4 font-semibold text-rz-navy">Feature</th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="p-4 text-center font-semibold text-rz-navy">
                      <span className="block">{p.name}</span>
                      <span className="block text-xs font-normal text-rz-muted">
                        {formatDuration(p.durationDays)} · {formatMoney(p.priceInSmallestUnit, p.currency)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k, i) => (
                  <tr key={k} className={i % 2 ? "bg-white" : "bg-rz-cream/40"}>
                    <th scope="row" className="p-4 text-left font-normal text-rz-text">{featureLabel(k)}</th>
                    {plans.map((p) => (
                      <td key={p.id} className="p-4 text-center">
                        {p.features?.[k] === true ? (
                          <>
                            <Check className="mx-auto h-4 w-4 text-rz-success" strokeWidth={2.5} aria-hidden />
                            <span className="sr-only">Included</span>
                          </>
                        ) : (
                          <>
                            <Minus className="mx-auto h-4 w-4 text-rz-border" strokeWidth={2.5} aria-hidden />
                            <span className="sr-only">Not included</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-rz-border bg-white">
                  <th scope="row" className="p-4 text-left font-normal text-rz-text">Access period</th>
                  {plans.map((p) => (
                    <td key={p.id} className="p-4 text-center text-xs font-medium text-rz-text">
                      {formatDuration(p.durationDays)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-rz-border bg-rz-peach/40 p-4 text-sm text-rz-text">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-rz-navy" strokeWidth={1.8} aria-hidden />
            <p>
              A membership is activated only after a payment is verified on our servers, never from your device alone.
              Online payments depend on a payment gateway being configured on this server; if one is not, checkout will tell you so.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
