"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, HeartHandshake, Loader2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Skeleton } from "@/components/ui/States";
import { FormAlert } from "@/components/auth/FormAlert";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { isApiError, type ApiError } from "@/lib/api/errors";
import type { PaymentView, VerifyPaymentResult } from "@/lib/api/types";
import type { MatchmakingCheckout, MatchmakingOffer } from "@/lib/api/matchmaking-types";
import { formatMoney } from "@/lib/format";
import { openRazorpayCheckout, redirectToGateway } from "@/lib/payments/gateway-handoff";
import { checkSession } from "@/components/home/heroSearch";

const DEV_BUILD = process.env.NODE_ENV !== "production";
const DASHBOARD = "/dashboard/matchmaking";

type Phase = { kind: "idle" } | { kind: "working"; label: string } | { kind: "signed-out" } | { kind: "done" } | { kind: "pending"; paymentId: string };
type RazorpayCheckout = { provider: "RAZORPAY"; keyId: string; orderId: string; amount: number; currency: string };

/**
 * Personal Matchmaking purchase. The price, currency and included access shown here come from the server, and the
 * server charges exactly that; the browser only records consent and hands over to the payment gateway. Payment is
 * confirmed by our server (verify / Razorpay signature), never by the browser alone.
 */
export function MatchmakingOfferClient() {
  const offer = useAsync((signal) => api.get<{ offer: MatchmakingOffer }>("/matchmaking/offer", { signal }), []);
  const [consented, setConsented] = useState(false);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function settle(result: VerifyPaymentResult) {
    if (result.status === "SUCCESS" || (result.status === "ALREADY_RESOLVED" && result.payment.status === "SUCCESS")) {
      setPhase({ kind: "done" });
      window.location.assign(DASHBOARD);
      return;
    }
    if (result.status === "PENDING") {
      setPhase({ kind: "pending", paymentId: result.payment.id });
      return;
    }
    setPhase({ kind: "idle" });
    setError(null);
    setNotice("The payment was not successful, so the service has not started. You can try again.");
  }

  async function verify(paymentId: string) {
    setPhase({ kind: "working", label: "Confirming your payment…" });
    try {
      await settle(await api.post<VerifyPaymentResult>(`/payments/${paymentId}/verify`));
    } catch (e) {
      setError(isApiError(e) ? e : null);
      setPhase({ kind: "pending", paymentId });
    }
  }

  /** Open the Razorpay window for an order and confirm the outcome with our server. */
  async function payViaRazorpay(paymentId: string, gw: RazorpayCheckout) {
    setPhase({ kind: "working", label: "Opening the payment window…" });
    const outcome = await openRazorpayCheckout({ keyId: gw.keyId, orderId: gw.orderId, amount: gw.amount, currency: gw.currency, planName: "Personal Matchmaking" });
    if (outcome.kind === "paid") {
      setPhase({ kind: "working", label: "Confirming your payment…" });
      await settle(await api.post<VerifyPaymentResult>(`/payments/${paymentId}/razorpay/confirm`, outcome.response));
    } else if (outcome.kind === "failed") {
      await verify(paymentId);
    } else {
      // Closed without paying: the order stays payable until it is paid or expires — "Continue payment" reopens it.
      setPhase({ kind: "pending", paymentId });
    }
  }

  /**
   * Reopen the SAME unpaid order (a new checkout is refused while one is pending). Only Razorpay orders can be
   * reopened in the page; for any other gateway the server says so (409) and we simply re-check the payment instead.
   */
  async function resume(paymentId: string) {
    setError(null);
    setNotice(null);
    setPhase({ kind: "working", label: "Reopening your payment…" });
    try {
      const res = await api.post<{ paymentId: string; gatewayCheckout: RazorpayCheckout }>(`/payments/${paymentId}/razorpay/resume`);
      await payViaRazorpay(res.paymentId, res.gatewayCheckout);
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        await verify(paymentId);
        return;
      }
      setError(isApiError(e) ? e : null);
      setPhase({ kind: "pending", paymentId });
    }
  }

  /** After a 409 from checkout: if it is because a matchmaking payment is still pending, offer to continue that one. */
  async function recoverPending(conflict: ApiError) {
    try {
      const res = await api.get<{ payments: PaymentView[] }>("/payments/me");
      const pending = [...(res?.payments ?? [])]
        .filter((p) => p.status === "PENDING" && p.matchmakingCaseId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (pending) {
        setError(null);
        setNotice(null);
        setPhase({ kind: "pending", paymentId: pending.id });
        return;
      }
    } catch {
      /* fall through to the original conflict message */
    }
    setError(conflict);
    setPhase({ kind: "idle" });
  }

  async function start(simulate?: "SUCCESS" | "FAILED" | "PENDING") {
    if (!offer.data?.offer || phase.kind === "working") return;
    setError(null);
    setNotice(null);
    setPhase({ kind: "working", label: "Checking your account…" });
    const session = await checkSession();
    if (session !== "signed-in") {
      setPhase({ kind: "signed-out" });
      return;
    }
    setPhase({ kind: "working", label: "Starting a secure checkout…" });
    try {
      const body: Record<string, unknown> = { consent: true, consentVersion: offer.data.offer.consentVersion };
      if (notes.trim()) body.customerNotes = notes.trim();
      if (DEV_BUILD && simulate) body.devSimulateOutcome = simulate;
      const { checkout } = await api.post<{ checkout: MatchmakingCheckout }>("/matchmaking/checkout", body);
      const gw = checkout.gatewayCheckout;
      if (gw?.provider === "RAZORPAY") {
        await payViaRazorpay(checkout.paymentId, gw);
        return;
      }
      if (gw?.provider === "PHONEPE") {
        if (redirectToGateway(gw.redirectUrl)) return; // the member comes back through /membership/payment-return
        setPhase({ kind: "pending", paymentId: checkout.paymentId });
        return;
      }
      await verify(checkout.paymentId);
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        await recoverPending(e);
        return;
      }
      setError(isApiError(e) ? e : null);
      setPhase({ kind: "idle" });
    }
  }

  if (offer.loading && !offer.data) return <Skeleton className="h-72 w-full" />;
  if (offer.error && !offer.data) return <ApiErrorView error={offer.error} onRetry={offer.reload} />;
  const o = offer.data!.offer;

  if (!o.available || o.priceInSmallestUnit === null) {
    return (
      <div className="rounded-lg border border-rz-border bg-white p-6 text-center">
        <p className="font-semibold text-rz-navy">Personal Matchmaking is not open for new members right now.</p>
        <p className="mt-1 text-sm text-rz-muted">Please check back soon, or explore membership plans meanwhile.</p>
        <ButtonLink href="/membership" variant="outline" className="mt-4">
          See membership plans
        </ButtonLink>
      </div>
    );
  }

  const busy = phase.kind === "working";
  const conflictCase = error && error.status === 409;

  return (
    <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 font-serif text-xl font-semibold text-rz-navy">
          <HeartHandshake className="h-5 w-5 text-rz-maroon" aria-hidden /> Personal Matchmaking
        </p>
        <p className="font-serif text-3xl font-bold text-rz-maroon">{formatMoney(o.priceInSmallestUnit, o.currency)}</p>
      </div>
      <ul className="mt-5 space-y-2 text-sm text-rz-text">
        <li className="flex gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-rz-success" aria-hidden /> A matchmaking specialist reviews your profile and partner preferences.
        </li>
        <li className="flex gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-rz-success" aria-hidden /> Hand-picked profile suggestions, shared in your dashboard.
        </li>
        <li className="flex gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-rz-success" aria-hidden />
          {o.includedMembershipDays > 0 ? `Includes ${o.includedMembershipDays} days of member access (interests and chat).` : "Member access (interests and chat) is not included."}
        </li>
      </ul>

      <label className="mt-6 block text-sm font-semibold text-rz-navy" htmlFor="mm-notes">
        Anything the matchmaking team should know? (optional)
      </label>
      <textarea
        id="mm-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={3}
        className="rz-focus mt-1.5 w-full rounded-md border border-rz-border p-3 text-sm"
      />

      <label className="mt-5 flex items-start gap-3 text-sm text-rz-text">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
        <span>{o.consentText}</span>
      </label>

      {phase.kind === "signed-out" && (
        <div role="region" aria-label="Sign in required" className="mt-5 rounded-lg border border-rz-border bg-rz-cream p-4">
          <p className="text-sm font-semibold text-rz-navy">Log in or create a free account to continue.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/login?next=%2Fpersonal-matchmaking" size="sm">Log in</ButtonLink>
            <ButtonLink href="/signup?next=%2Fpersonal-matchmaking" size="sm" variant="outline">Create account</ButtonLink>
          </div>
        </div>
      )}
      {phase.kind === "pending" && (
        <div className="mt-4" role="status">
          <FormAlert tone="info">
            Your Personal Matchmaking payment has not been completed yet. If you closed the payment window, you can continue the same payment — you will not be charged twice.
            <span className="mt-2 flex flex-wrap gap-3">
              <button type="button" className="font-semibold underline" onClick={() => void resume(phase.paymentId)}>
                Continue payment
              </button>
              <button type="button" className="font-semibold underline" onClick={() => void verify(phase.paymentId)}>
                Check payment status
              </button>
            </span>
          </FormAlert>
        </div>
      )}
      {notice && (
        <div className="mt-4" role="alert">
          <FormAlert tone="error">{notice}</FormAlert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <FormAlert tone="error">
            {error.message}
            {conflictCase && (
              <>
                {" "}
                <Link href={DASHBOARD} className="font-semibold underline">
                  Open my Personal Matchmaking
                </Link>
              </>
            )}
          </FormAlert>
        </div>
      )}

      <Button className="mt-6" fullWidth size="lg" disabled={!consented || busy || phase.kind === "pending"} aria-busy={busy} onClick={() => void start()}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {phase.label}
          </>
        ) : (
          `Start Personal Matchmaking · ${formatMoney(o.priceInSmallestUnit, o.currency)}`
        )}
      </Button>
      {DEV_BUILD && (
        <p className="mt-3 text-center text-xs text-rz-muted">
          Development: simulate{" "}
          {(["SUCCESS", "FAILED", "PENDING"] as const).map((s) => (
            <button key={s} type="button" disabled={!consented || busy} className="mx-1 underline" onClick={() => void start(s)}>
              {s.toLowerCase()}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
