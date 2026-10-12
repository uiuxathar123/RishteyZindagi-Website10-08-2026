"use client";

import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { ApiError } from "@/lib/api/errors";
import type { MembershipPlan, MembershipView } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { formatDuration } from "@/components/membership/planUtils";

type View =
  | { kind: "active"; membership: MembershipView }
  | { kind: "ended"; membership: MembershipView }
  | { kind: "none" };

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function CurrentMembershipCard({
  memberships,
  plans,
  plansError,
  hasPendingPayment,
  onChanged,
}: {
  memberships: MembershipView[];
  plans: MembershipPlan[] | null;
  plansError: ApiError | null;
  /** True only when a payment is genuinely still PENDING (not merely a stale PENDING membership row). */
  hasPendingPayment: boolean;
  onChanged: (m: MembershipView) => void;
}) {
  // Never trust "the most recent row": a newer PENDING checkout must not hide an ACTIVE membership.
  const view: View = useMemo(() => {
    const now = Date.now();
    const sorted = [...memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const active = sorted.find((m) => m.status === "ACTIVE" && (!m.expiresAt || new Date(m.expiresAt).getTime() > now));
    if (active) return { kind: "active", membership: active };
    const ended = sorted.find((m) => m.status !== "PENDING");
    return ended ? { kind: "ended", membership: ended } : { kind: "none" };
  }, [memberships]);
  const hasPending = hasPendingPayment;

  const toggle = useAction(async (m: MembershipView, enable: boolean) => {
    const res = await api.post<{ membership: MembershipView }>(
      `/memberships/me/${m.id}/${enable ? "enable-auto-renew" : "cancel-auto-renew"}`
    );
    onChanged(res.membership);
    return res.membership;
  });

  if (view.kind === "none") {
    return (
      <div className="rounded-lg border border-rz-border bg-white p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Icon />
            <div>
              <p className="font-serif text-base font-semibold text-rz-navy">No active membership</p>
              <p className="mt-1 text-sm text-rz-muted">
                You&apos;re on the free tier. A membership unlocks sending interests and chat.
              </p>
            </div>
          </div>
          <ButtonLink href="/membership">See plans</ButtonLink>
        </div>
        {hasPending && <PendingNote />}
      </div>
    );
  }

  const { membership: m } = view;
  const plan = plans?.find((p) => p.id === m.planId) ?? null;
  const name = plan?.name ?? (plansError ? "Membership" : "…");
  const remaining = daysLeft(m.expiresAt);
  const isActive = view.kind === "active";
  const statusBadge = isActive ? (
    <Badge tone="success">Active</Badge>
  ) : m.status === "CANCELLED" ? (
    <Badge tone="neutral">Cancelled</Badge>
  ) : (
    <Badge tone="gold">Expired</Badge>
  );

  return (
    <div className="rounded-lg border border-rz-border bg-white p-5 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Icon />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-serif text-base font-semibold text-rz-navy">{name} Plan</p>
              {statusBadge}
            </div>
            {plan && <p className="mt-0.5 text-xs text-rz-muted">{formatDuration(plan.durationDays)} access</p>}
            <p className="mt-1 text-sm text-rz-muted">
              {isActive
                ? `Valid until ${formatDate(m.expiresAt)}${remaining !== null ? ` (${remaining} day${remaining === 1 ? "" : "s"} left)` : ""}`
                : m.status === "CANCELLED"
                  ? `Ended ${m.expiresAt ? formatDate(m.expiresAt) : ""}`.trim()
                  : `Expired on ${formatDate(m.expiresAt)}`}
            </p>
            {m.startedAt && <p className="text-xs text-rz-muted">Started {formatDate(m.startedAt)}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {plan ? (
            <ButtonLink href={`/membership/checkout?plan=${encodeURIComponent(plan.code)}`}>
              {isActive ? "Renew now" : "Renew plan"}
            </ButtonLink>
          ) : (
            <ButtonLink href="/membership">See plans</ButtonLink>
          )}
        </div>
      </div>

      {!isActive && (
        <p className="mt-4 rounded-md bg-rz-peach/50 p-3 text-xs leading-relaxed text-rz-text">
          Your membership is no longer active, so features that need one (such as sending interests and chat) are paused.
          Renew or choose a plan below to continue.
        </p>
      )}

      {isActive && (
        <div className="mt-5 flex items-start justify-between gap-4 border-t border-rz-border pt-4">
          <div className="min-w-0">
            <p id="auto-renew-label" className="text-sm font-semibold text-rz-navy">
              Renewal reminders
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-rz-muted">
              {m.autoRenew ? "Renewal reminders are on." : "Renewal reminders are off."} We&apos;ll remind you before this ends and follow
              up once if it lapses. Your card is never charged automatically: you renew from this page before{" "}
              {formatDate(m.expiresAt)}. Turning it off never ends your current period.
            </p>
            {toggle.error && (
              <p role="alert" className="mt-2 text-xs text-rz-danger">
                {toggle.error.friendlyMessage}
              </p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={m.autoRenew}
            aria-labelledby="auto-renew-label"
            disabled={toggle.pending}
            onClick={() => toggle.run(m, !m.autoRenew)}
            className={cn(
              "rz-focus relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
              m.autoRenew ? "bg-rz-maroon" : "bg-rz-border"
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                m.autoRenew && "translate-x-5"
              )}
            />
          </button>
        </div>
      )}
      {hasPending && <PendingNote />}
    </div>
  );
}

function PendingNote() {
  return (
    <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
      You have a checkout that was started but not completed. If a payment below shows &ldquo;Pending&rdquo;, use
      &ldquo;Check status&rdquo; on it.
    </p>
  );
}

function Icon() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-maroon">
      <ShieldCheck className="h-6 w-6" strokeWidth={1.8} aria-hidden />
    </span>
  );
}
