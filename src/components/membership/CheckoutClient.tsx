"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, CreditCard, FlaskConical, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { ApiError } from "@/lib/api/errors";
import { isApiError } from "@/lib/api/errors";
import type {
  CheckoutResult,
  InvoiceDetail,
  InvoiceSummary,
  MembershipPlan,
  MembershipView,
  PaymentView,
  VerifyPaymentResult,
} from "@/lib/api/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { featureKeysOf, featureLabel, formatDuration } from "./planUtils";
import { InvoiceDownloadButton } from "./InvoiceDownloadButton";

/**
 * Development-only. `process.env.NODE_ENV` is inlined by Next at build time,
 * so in a production build this is the literal `false`, the dev panel and the
 * `devSimulateOutcome` field are dead code and are not shipped. The backend
 * is the authority in any case: outside development it ignores/rejects the
 * simulation (real gateway providers throw before reading it).
 */
const DEV_BUILD = process.env.NODE_ENV !== "production";

type SimOutcome = "SUCCESS" | "FAILED" | "PENDING";

interface Receipt {
  payment: PaymentView;
  membership: MembershipView | null;
  invoice: InvoiceSummary | null;
  simulated: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: "order" | "verify" | "receipt" }
  | { kind: "success"; receipt: Receipt }
  | { kind: "pending"; paymentId: string; simulated: boolean }
  | { kind: "failed"; payment: PaymentView | null; simulated: boolean }
  | { kind: "other"; payment: PaymentView };

export function CheckoutClient({ planCode }: { planCode: string }) {
  const plans = useAsync<{ plans: MembershipPlan[]; active: MembershipView | null; activePlan: MembershipPlan | null }>(
    async (signal) => {
      const [catalogue, history] = await Promise.all([
        api.get<{ plans: MembershipPlan[] }>("/membership-plans", { signal }),
        api.get<{ memberships: MembershipView[] }>("/memberships/me/history", { signal }).catch((e) => {
          if (isApiError(e) && e.kind === "aborted") throw e;
          return null; // the summary below is a nicety; checkout itself does not depend on it
        }),
      ]);
      const all = catalogue?.plans ?? [];
      const now = Date.now();
      const active =
        history?.memberships.find((m) => m.status === "ACTIVE" && (!m.expiresAt || new Date(m.expiresAt).getTime() > now)) ?? null;
      return { plans: all, active, activePlan: active ? (all.find((p) => p.id === active.planId) ?? null) : null };
    },
    []
  );

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<ApiError | null>(null);
  const [sim, setSim] = useState<SimOutcome>("SUCCESS");

  const plan = plans.data?.plans.find((p) => p.code === planCode) ?? null;

  const loadReceipt = useCallback(async (payment: PaymentView, simulated: boolean): Promise<Receipt> => {
    const [hist, inv] = await Promise.all([
      api.get<{ memberships: MembershipView[] }>("/memberships/me/history").catch(() => null),
      api.get<{ invoices: InvoiceSummary[] }>("/invoices/me").catch(() => null),
    ]);
    const membership = hist?.memberships.find((m) => m.id === payment.membershipId) ?? null;
    let invoice: InvoiceSummary | null = null;
    const candidates = [...(inv?.invoices ?? [])].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 5);
    for (const c of candidates) {
      try {
        const detail = await api.get<{ invoice: InvoiceDetail }>(`/invoices/${c.id}`);
        if (detail?.invoice.paymentId === payment.id) {
          invoice = c;
          break;
        }
      } catch {
        /* try the next one */
      }
    }
    return { payment, membership, invoice, simulated };
  }, []);

  const settle = useCallback(
    async (result: VerifyPaymentResult, simulated: boolean) => {
      const { payment } = result;
      if (payment.status === "SUCCESS") {
        setPhase({ kind: "working", step: "receipt" });
        setPhase({ kind: "success", receipt: await loadReceipt(payment, simulated) });
      } else if (payment.status === "FAILED") {
        setPhase({ kind: "failed", payment, simulated });
      } else if (payment.status === "PENDING" || result.status === "PENDING") {
        setPhase({ kind: "pending", paymentId: payment.id, simulated });
      } else {
        setPhase({ kind: "other", payment });
      }
    },
    [loadReceipt]
  );

  /** POST /payments/:id/verify — idempotent on the server. */
  const verify = useCallback(
    async (paymentId: string, simulated: boolean) => {
      setError(null);
      setPhase({ kind: "working", step: "verify" });
      try {
        const result = await api.post<VerifyPaymentResult>(`/payments/${paymentId}/verify`);
        await settle(result, simulated);
      } catch (e) {
        if (isApiError(e) && e.kind === "aborted") return;
        setError(isApiError(e) ? e : null);
        // The order exists; let the member re-check it rather than starting over.
        setPhase({ kind: "pending", paymentId, simulated });
      }
    },
    [settle]
  );

  const startPayment = useCallback(
    async (simulate?: SimOutcome) => {
      if (!plan) return;
      setError(null);
      setPhase({ kind: "working", step: "order" });
      try {
        const body: { planCode: string; devSimulateOutcome?: SimOutcome } = { planCode: plan.code };
        if (DEV_BUILD && simulate) body.devSimulateOutcome = simulate;
        const order = await api.post<CheckoutResult>("/memberships/checkout", body);
        await verify(order.paymentId, Boolean(DEV_BUILD && simulate));
      } catch (e) {
        if (isApiError(e) && e.kind === "aborted") return;
        setError(isApiError(e) ? e : null);
        setPhase({ kind: "idle" });
      }
    },
    [plan, verify]
  );

  /** 409 "already pending": find the newest PENDING payment and re-verify it. */
  const checkExistingPending = useCallback(async () => {
    setError(null);
    setPhase({ kind: "working", step: "verify" });
    try {
      const res = await api.get<{ payments: PaymentView[] }>("/payments/me");
      const pending = [...(res?.payments ?? [])]
        .filter((p) => p.status === "PENDING")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!pending) {
        setPhase({ kind: "idle" });
        setError(null);
        return;
      }
      await verify(pending.id, false);
    } catch (e) {
      if (isApiError(e) && e.kind === "aborted") return;
      setError(isApiError(e) ? e : null);
      setPhase({ kind: "idle" });
    }
  }, [verify]);

  // ---------------------------------------------------------------- loading / plan problems
  if (plans.loading && !plans.data) {
    return (
      <div role="status" aria-label="Loading checkout" className="space-y-5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }
  if (!plans.data) return plans.error ? <ApiErrorView error={plans.error} onRetry={plans.reload} /> : null;

  if (!planCode || !plan) {
    return (
      <Notice tone="warn" title={planCode ? "That plan isn't available" : "No plan selected"}>
        <p>
          {planCode
            ? "The plan you picked doesn't exist or is no longer offered."
            : "Choose a plan first, then come back to check out."}
        </p>
        <ButtonLink href="/membership" className="mt-4">
          View membership plans
        </ButtonLink>
      </Notice>
    );
  }

  // ---------------------------------------------------------------- outcomes
  if (phase.kind === "success") return <SuccessView receipt={phase.receipt} plan={plan} />;

  if (phase.kind === "failed") {
    return (
      <Notice tone="danger" title="Payment failed" icon={<XCircle className="h-7 w-7" />}>
        <p>
          The payment was not successful, so your membership was <strong>not</strong> activated and nothing was
          charged for this attempt.
        </p>
        {phase.simulated && <SimulatedTag />}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button onClick={() => setPhase({ kind: "idle" })}>Try again</Button>
          <ButtonLink href="/dashboard/membership" variant="outline">
            My membership
          </ButtonLink>
        </div>
      </Notice>
    );
  }

  if (phase.kind === "other") {
    return (
      <Notice tone="warn" title={`Payment status: ${phase.payment.status.toLowerCase()}`}>
        <p>This payment is not in a state that activates a membership.</p>
        <ButtonLink href="/dashboard/membership" className="mt-4">
          My membership
        </ButtonLink>
      </Notice>
    );
  }

  if (phase.kind === "pending") {
    return (
      <Notice tone="warn" title="Payment is still pending" icon={<Clock className="h-7 w-7" />}>
        <p>
          The payment hasn&apos;t been confirmed yet, so your membership is <strong>not</strong> active. Nothing is
          granted until our servers verify the payment.
        </p>
        {phase.simulated && <SimulatedTag />}
        {error && <InlineError error={error} />}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button onClick={() => verify(phase.paymentId, phase.simulated)}>
            Check status again
          </Button>
          <ButtonLink href="/dashboard/membership" variant="outline">
            My membership
          </ButtonLink>
        </div>
      </Notice>
    );
  }

  // ---------------------------------------------------------------- idle / working
  const working = phase.kind === "working";
  const stepLabel =
    phase.kind === "working"
      ? phase.step === "order"
        ? "Creating your order…"
        : phase.step === "verify"
          ? "Verifying payment with the server…"
          : "Loading your verified receipt…"
      : "";
  const keys = featureKeysOf([plan]);
  const price = formatMoney(plan.priceInSmallestUnit, plan.currency);
  const { active, activePlan } = plans.data;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-rz-border bg-white p-5 shadow-card-sm md:p-6">
        <h2 className="mb-4 font-serif text-lg font-semibold text-rz-navy">Order summary</h2>
        <div className="flex items-center justify-between gap-4 border-b border-rz-border pb-4">
          <div className="min-w-0">
            <p className="font-medium text-rz-text">{plan.name} Membership</p>
            <p className="text-xs text-rz-muted">{formatDuration(plan.durationDays)} access</p>
          </div>
          <p className="shrink-0 font-serif text-xl font-bold text-rz-navy">{price}</p>
        </div>
        <ul className="mt-4 space-y-2">
          {keys
            .filter((k) => plan.features?.[k] === true)
            .map((k) => (
              <li key={k} className="text-[13px] text-rz-muted">
                • {featureLabel(k)}
              </li>
            ))}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-rz-border pt-4">
          <p className="text-sm font-semibold text-rz-navy">Total due today</p>
          <p className="font-serif text-2xl font-bold text-rz-maroon">{price}</p>
        </div>
        {active && (
          <p className="mt-4 rounded-md bg-rz-peach/50 p-3 text-xs leading-relaxed text-rz-text">
            You currently have an active {activePlan?.name ?? "membership"} (until {formatDate(active.expiresAt)}). When this
            payment is verified, the new period starts immediately and your current membership is ended; unused days are not
            carried over.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-rz-border bg-white p-5 shadow-card-sm md:p-6">
        <h2 className="mb-1 font-serif text-lg font-semibold text-rz-navy">Payment</h2>

        {error && <PaymentErrorPanel error={error} onCheckPending={checkExistingPending} />}

        {DEV_BUILD ? (
          <DevPanel sim={sim} setSim={setSim} working={working} stepLabel={stepLabel} price={price} onRun={() => startPayment(sim)} />
        ) : (
          <>
            <p className="mb-4 text-xs text-rz-muted">
              Payments are taken by the payment gateway that the site administrator has activated.
            </p>
            <div className="flex items-center gap-3 rounded-lg border border-rz-border bg-rz-peach/30 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-rz-maroon shadow-card-sm">
                <CreditCard className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              </span>
              <p className="text-sm text-rz-text">The gateway is confirmed when you start the payment.</p>
            </div>
            <Button
              fullWidth
              size="lg"
              className="mt-5"
              disabled={working}
              onClick={() => startPayment()}
              icon={working ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {working ? stepLabel : `Pay ${price}`}
            </Button>
          </>
        )}
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-rz-muted" aria-live="polite">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Your membership activates only after payment is verified on our servers.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function DevPanel({
  sim,
  setSim,
  working,
  stepLabel,
  price,
  onRun,
}: {
  sim: SimOutcome;
  setSim: (s: SimOutcome) => void;
  working: boolean;
  stepLabel: string;
  price: string;
  onRun: () => void;
}) {
  const options: { value: SimOutcome; label: string; hint: string }[] = [
    { value: "SUCCESS", label: "Success", hint: "payment verifies and the membership activates" },
    { value: "FAILED", label: "Failure", hint: "payment fails, nothing activates" },
    { value: "PENDING", label: "Pending", hint: "payment never resolves on its own" },
  ];
  return (
    <section
      aria-labelledby="dev-payment-title"
      className="mt-3 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-amber-950"
    >
      <h3 id="dev-payment-title" className="flex items-center gap-2 text-sm font-bold">
        <FlaskConical className="h-4 w-4" aria-hidden /> Development test payment (no real money)
      </h3>
      <p className="mt-1 text-[12.5px] leading-relaxed">
        This is a development build. The server routes the payment through its built-in mock gateway, which exists only
        outside production. No card, UPI or bank is involved and no money moves. If the server has no payment gateway
        activated, it will refuse and tell you so.
      </p>
      <fieldset className="mt-3" disabled={working}>
        <legend className="text-xs font-semibold">Simulated outcome</legend>
        <div className="mt-1.5 space-y-1.5">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="radio"
                name="dev-outcome"
                value={o.value}
                checked={sim === o.value}
                onChange={() => setSim(o.value)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{o.label}</span>
                <span className="text-amber-900/80"> — {o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button
        fullWidth
        size="lg"
        className="mt-4"
        disabled={working}
        onClick={onRun}
        icon={working ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
      >
        {working ? stepLabel : `Run simulated payment (${price})`}
      </Button>
    </section>
  );
}

function SimulatedTag() {
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Development simulation, no real money
    </p>
  );
}

function Notice({
  tone,
  title,
  icon,
  children,
}: {
  tone: "warn" | "danger";
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-xl border border-rz-border bg-white p-8 text-center shadow-card-sm"
    >
      <span
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full",
          tone === "danger" ? "bg-rz-danger/10 text-rz-danger" : "bg-amber-100 text-amber-700"
        )}
      >
        {icon ?? <AlertTriangle className="h-7 w-7" strokeWidth={1.7} />}
      </span>
      <h2 className="font-serif text-2xl font-semibold text-rz-navy">{title}</h2>
      <div className="max-w-md text-sm text-rz-muted">{children}</div>
    </div>
  );
}

function InlineError({ error }: { error: ApiError }) {
  return (
    <p role="alert" className="mt-3 text-sm text-rz-danger">
      {error.friendlyMessage}
    </p>
  );
}

/** Maps every backend failure kind to an honest, specific message. */
function PaymentErrorPanel({ error, onCheckPending }: { error: ApiError; onCheckPending: () => void }) {
  let title = "Something went wrong";
  let body: string = error.friendlyMessage;
  let action: React.ReactNode = null;

  switch (error.kind) {
    case "unavailable":
      title = "Online payments are not configured on this server";
      body = `${error.message} No payment was taken and your membership has not changed.`;
      break;
    case "conflict":
      title = "This checkout can't go ahead";
      body = error.message;
      if (/already pending/i.test(error.message)) {
        action = (
          <Button size="sm" variant="outline" className="mt-3" onClick={onCheckPending}>
            Check the pending payment
          </Button>
        );
      }
      break;
    case "rate_limited":
      title = "Too many attempts";
      body = "You're doing that too quickly. Wait a minute, then try again.";
      break;
    case "not_found":
      title = "Plan not found";
      body = error.message;
      break;
    case "forbidden":
      title = "Not allowed";
      body = error.message;
      break;
    case "validation":
      title = "The request was rejected";
      body = error.friendlyMessage;
      break;
    case "network":
      title = "Can't reach the server";
      break;
    case "server":
      title = "Server error";
      break;
  }

  return (
    <div role="alert" className="my-3 rounded-lg border border-rz-danger/30 bg-rz-danger/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-rz-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {title}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-rz-text">{body}</p>
      {action}
    </div>
  );
}

function SuccessView({ receipt, plan }: { receipt: Receipt; plan: MembershipPlan }) {
  const { payment, membership, invoice, simulated } = receipt;
  const rows: [string, string][] = [
    ["Plan", plan.name],
    ["Membership status", membership ? membership.status.toLowerCase() : "see your dashboard"],
    ["Valid until", membership?.expiresAt ? formatDateTime(membership.expiresAt) : "—"],
    ["Amount verified", formatMoney(payment.amountInPaise, payment.currency)],
    ["Payment reference", payment.gatewayReference ?? payment.id],
    ["Verified at", payment.verifiedAt ? formatDateTime(payment.verifiedAt) : "—"],
  ];
  return (
    <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8" role="status">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rz-success/10 text-rz-success">
          <CheckCircle2 className="h-8 w-8" strokeWidth={1.6} aria-hidden />
        </span>
        <h2 className="font-serif text-2xl font-semibold text-rz-navy">Payment verified</h2>
        <p className="max-w-sm text-sm text-rz-muted">
          The server verified this payment{membership?.status === "ACTIVE" ? " and your membership is active." : "."}
        </p>
        {simulated && <SimulatedTag />}
      </div>

      <dl className="mt-6 divide-y divide-rz-border rounded-lg border border-rz-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-rz-muted">{k}</dt>
            <dd className="min-w-0 break-all font-medium text-rz-text sm:text-right">{v}</dd>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <dt className="text-rz-muted">Invoice</dt>
          <dd className="font-medium text-rz-text">
            {invoice ? (
              <span className="flex flex-wrap items-center gap-3">
                <span>{invoice.invoiceNumber}</span>
                <InvoiceDownloadButton invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} />
              </span>
            ) : (
              <span className="text-rz-muted">
                Not listed yet — find it later in{" "}
                <Link href="/dashboard/membership" className="underline">
                  My Membership
                </Link>
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-6 text-center">
        <ButtonLink href="/dashboard/membership" size="lg">
          Go to My Membership
        </ButtonLink>
      </div>
    </div>
  );
}
