"use client";

import { useCallback, useMemo } from "react";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { InvoiceDetail, InvoiceSummary, MembershipPlan, MembershipView, PaymentView } from "@/lib/api/types";
import { AsyncView } from "@/components/ui/AsyncView";
import { Skeleton } from "@/components/ui/States";
import { PlansCatalog } from "@/components/membership/PlansCatalog";
import { CurrentMembershipCard } from "./CurrentMembershipCard";
import { PaymentsSection } from "./PaymentsSection";
import { InvoicesSection, type InvoiceRow } from "./InvoicesSection";

/** The whole dashboard membership screen. Each block loads (and fails) independently. */
export function MembershipDashboard() {
  const history = useAsync<MembershipView[]>(
    async (signal) => (await api.get<{ memberships: MembershipView[] }>("/memberships/me/history", { signal }))?.memberships ?? [],
    []
  );
  const plans = useAsync<MembershipPlan[]>(
    async (signal) => (await api.get<{ plans: MembershipPlan[] }>("/membership-plans", { signal }))?.plans ?? [],
    []
  );
  const payments = useAsync<PaymentView[]>(
    async (signal) => (await api.get<{ payments: PaymentView[] }>("/payments/me", { signal }))?.payments ?? [],
    []
  );
  const invoices = useAsync<InvoiceRow[]>(async (signal) => {
    const list = (await api.get<{ invoices: InvoiceSummary[] }>("/invoices/me", { signal }))?.invoices ?? [];
    // Each invoice's stored snapshot carries its currency and plan name (the list view does not).
    return Promise.all(
      list.slice(0, 50).map(async (inv): Promise<InvoiceRow> => {
        try {
          const d = await api.get<{ invoice: InvoiceDetail }>(`/invoices/${inv.id}`, { signal });
          return { ...inv, detail: d?.invoice ?? null };
        } catch {
          return { ...inv, detail: null };
        }
      })
    );
  }, []);

  const { reload: reloadHistory } = history;
  const { reload: reloadPayments } = payments;
  const { reload: reloadInvoices } = invoices;
  const refreshAll = useCallback(() => {
    reloadHistory();
    reloadPayments();
    reloadInvoices();
  }, [reloadHistory, reloadPayments, reloadInvoices]);

  const active = useMemo(() => {
    const now = Date.now();
    return (
      history.data?.find((m) => m.status === "ACTIVE" && (!m.expiresAt || new Date(m.expiresAt).getTime() > now)) ?? null
    );
  }, [history.data]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="current-membership">
        <h3 id="current-membership" className="sr-only">
          Current membership
        </h3>
        <AsyncView
          data={history.data}
          error={history.error}
          loading={history.loading}
          reload={history.reload}
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          {(memberships) => (
            <CurrentMembershipCard
              memberships={memberships}
              plans={plans.data}
              plansError={plans.error}
              hasPendingPayment={payments.data?.some((p) => p.status === "PENDING") ?? false}
              onChanged={(updated) =>
                history.setData((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev))
              }
            />
          )}
        </AsyncView>
      </section>

      <section aria-labelledby="plans-heading">
        <h3 id="plans-heading" className="mb-4 font-serif text-lg font-semibold text-rz-navy">
          {active ? "Upgrade or renew" : "Choose a plan"}
        </h3>
        {history.data === null && history.loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <PlansCatalog current={active ? { planId: active.planId, expiresAt: active.expiresAt } : null} />
        )}
      </section>

      <section aria-labelledby="payments-heading">
        <h3 id="payments-heading" className="mb-4 font-serif text-lg font-semibold text-rz-navy">
          Payment history
        </h3>
        <PaymentsSection state={payments} onVerified={refreshAll} />
      </section>

      <section aria-labelledby="invoices-heading">
        <h3 id="invoices-heading" className="mb-4 font-serif text-lg font-semibold text-rz-navy">
          Invoices
        </h3>
        <InvoicesSection state={invoices} />
      </section>
    </div>
  );
}
