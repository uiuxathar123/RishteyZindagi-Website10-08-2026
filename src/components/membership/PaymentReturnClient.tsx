"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { api } from "@/lib/api/client";
import { isApiError, type ApiError } from "@/lib/api/errors";
import type { VerifyPaymentResult } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type State =
  | { kind: "checking" }
  | { kind: "result"; result: VerifyPaymentResult }
  | { kind: "error"; error: ApiError };

const AUTO_RETRIES = 4;
const RETRY_MS = 4000;

/**
 * Asks OUR server for the verdict (it queries the gateway directly). The query string only carries
 * the payment id; it never says whether the payment worked. A still-pending payment is re-checked a
 * few times automatically, then left for the member to re-check.
 */
export function PaymentReturnClient({ paymentId }: { paymentId: string }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const result = await api.post<VerifyPaymentResult>(`/payments/${paymentId}/verify`);
      setState({ kind: "result", result });
      if (result.payment.status === "PENDING" && attempts.current < AUTO_RETRIES) {
        attempts.current += 1;
        timer.current = setTimeout(check, RETRY_MS);
      }
    } catch (e) {
      if (isApiError(e) && e.kind === "aborted") return;
      if (isApiError(e)) setState({ kind: "error", error: e });
    }
  }, [paymentId]);

  useEffect(() => {
    if (!paymentId) return;
    attempts.current = 0;
    void check();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [paymentId, check]);

  if (!paymentId) {
    return (
      <Panel icon={<XCircle className="h-7 w-7 text-rz-danger" />} title="We couldn't find that payment">
        <p>This link is missing its payment reference. Open My membership to see your payments.</p>
        <ButtonLink href="/dashboard/membership" className="mt-5">
          My membership
        </ButtonLink>
      </Panel>
    );
  }
  if (state.kind === "error") return <ApiErrorView error={state.error} onRetry={check} />;
  if (state.kind === "checking") {
    return (
      <Panel icon={<Loader2 className="h-7 w-7 animate-spin text-rz-maroon" />} title="Confirming your payment…">
        <p role="status">Please wait while we confirm the result with the payment gateway. Don&apos;t close this page.</p>
      </Panel>
    );
  }

  const { payment } = state.result;
  const amount = formatMoney(payment.amountInPaise, payment.currency);
  if (payment.status === "SUCCESS" && payment.matchmakingCaseId) {
    return (
      <Panel icon={<CheckCircle2 className="h-7 w-7 text-rz-success" />} title="Payment successful">
        <p>We received {amount}. Your Personal Matchmaking has started and your invoice is in My membership.</p>
        <ButtonLink href="/dashboard/matchmaking" className="mt-5">
          Open Personal Matchmaking
        </ButtonLink>
      </Panel>
    );
  }
  if (payment.status === "FAILED" && payment.matchmakingCaseId) {
    return (
      <Panel icon={<XCircle className="h-7 w-7 text-rz-danger" />} title="Payment failed">
        <p>The payment was not successful, so Personal Matchmaking has not started.</p>
        <ButtonLink href="/personal-matchmaking" className="mt-5">
          Try again
        </ButtonLink>
      </Panel>
    );
  }
  if (payment.status === "SUCCESS") {
    return (
      <Panel icon={<CheckCircle2 className="h-7 w-7 text-rz-success" />} title="Payment successful">
        <p>
          We received {amount}. Your membership is active and your invoice is in My membership.
        </p>
        <ButtonLink href="/dashboard/membership" className="mt-5">
          View my membership
        </ButtonLink>
      </Panel>
    );
  }
  if (payment.status === "FAILED") {
    return (
      <Panel icon={<XCircle className="h-7 w-7 text-rz-danger" />} title="Payment failed">
        <p>The payment was not successful, so your membership was not activated.</p>
        <ButtonLink href="/membership" className="mt-5">
          Choose a plan again
        </ButtonLink>
      </Panel>
    );
  }
  if (payment.status === "REFUNDED") {
    return (
      <Panel icon={<Clock className="h-7 w-7 text-rz-muted" />} title="Payment refunded">
        <p>This payment has been refunded.</p>
        <ButtonLink href="/dashboard/membership" className="mt-5">
          My membership
        </ButtonLink>
      </Panel>
    );
  }
  return (
    <Panel icon={<Clock className="h-7 w-7 text-rz-warning" />} title="Payment still pending">
      <p>
        The gateway has not confirmed this payment yet, so your membership is <strong>not</strong> active. If money was taken it will be applied automatically once the bank confirms; otherwise it is released by your bank.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button
          onClick={() => {
            attempts.current = 0;
            void check();
          }}
        >
          Check again
        </Button>
        <ButtonLink href="/dashboard/membership" variant="outline">
          My membership
        </ButtonLink>
      </div>
    </Panel>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rz-border bg-white p-8 text-center shadow-card-sm [&_p]:text-sm [&_p]:text-rz-text">
      <div className="mb-3 flex justify-center" aria-hidden>
        {icon}
      </div>
      <h1 className="mb-3 font-serif text-2xl font-bold text-rz-navy">{title}</h1>
      {children}
    </div>
  );
}
