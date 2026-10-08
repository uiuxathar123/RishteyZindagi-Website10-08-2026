import type { MembershipPlan } from "@/lib/api/types";
import { humanize } from "@/lib/format";

/**
 * Display helpers for the membership catalogue. Nothing here invents plans,
 * prices or feature availability: every plan, price and flag comes from
 * `GET /membership-plans`. The only static content is the human-readable
 * *label* for each feature-flag key the backend is known to emit; a flag
 * the backend adds later is still shown (humanized key) instead of dropped.
 */
const FEATURE_LABELS: Record<string, string> = {
  chat: "Chat with your matches",
  unlimitedInterests: "Unlimited interests",
  shortlist: "Shortlist profiles",
  advancedSearch: "Advanced search filters",
  visibilityBoost: "Profile visibility boost",
};
const FEATURE_ORDER = Object.keys(FEATURE_LABELS);

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? humanize(key.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

/** Flag keys present on at least one plan, in a stable, readable order. */
export function featureKeysOf(plans: MembershipPlan[]): string[] {
  const keys = new Set<string>();
  for (const p of plans) for (const k of Object.keys(p.features ?? {})) keys.add(k);
  const known = FEATURE_ORDER.filter((k) => keys.has(k));
  const extra = Array.from(keys).filter((k) => !FEATURE_ORDER.includes(k)).sort();
  return [...known, ...extra];
}

export function enabledFeatureKeys(plan: MembershipPlan): string[] {
  return featureKeysOf([plan]).filter((k) => plan.features?.[k] === true);
}

export function formatDuration(days: number): string {
  if (days === 30) return "1 month";
  if (days % 30 === 0 && days >= 60 && days <= 360) return `${days / 30} months`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function sortPlans(plans: MembershipPlan[]): MembershipPlan[] {
  return [...plans].sort((a, b) => a.durationDays - b.durationDays);
}

export function currenciesOf(plans: MembershipPlan[]): string[] {
  const set = new Set(plans.map((p) => p.currency));
  // INR first, then USD, then anything else the backend may add.
  return Array.from(set).sort((a, b) => (a === "INR" ? -1 : b === "INR" ? 1 : a.localeCompare(b)));
}

/** The member's ACTIVE membership, passed down from the server so public plan pages can highlight it. */
export interface CurrentMembershipSummary {
  planId: string;
  expiresAt: string | null;
}
