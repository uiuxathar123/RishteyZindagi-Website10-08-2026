"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge, CompanyVerifiedBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { COMPANY_VERIFICATION_LABEL, type AdminMemberSummary, type CompanyVerificationStatus, type CompanyVerificationView } from "@/lib/api/matchmaking-types";
import { formatDateTime } from "@/lib/format";
import { ActionError, Card, PageHeader, SuccessNote, useDebounced } from "./AdminUi";
import { ConfirmDialog } from "./ConfirmDialog";

type Decision = Exclude<CompanyVerificationStatus, "NONE">;

/** What each current status allows (the server enforces the same rules). */
const NEXT: Record<CompanyVerificationStatus, Array<{ to: Decision; label: string; variant?: "outline" | "ghost" }>> = {
  NONE: [{ to: "PENDING", label: "Open review" }],
  REJECTED: [{ to: "PENDING", label: "Open a new review" }],
  REVOKED: [{ to: "PENDING", label: "Open a new review" }],
  PENDING: [
    { to: "APPROVED", label: "Approve — Company Verified" },
    { to: "REJECTED", label: "Reject", variant: "outline" },
  ],
  APPROVED: [{ to: "REVOKED", label: "Revoke badge", variant: "ghost" }],
};

function Review({ member, onBack }: { member: AdminMemberSummary; onBack: () => void }) {
  const view = useAsync((signal) => adminApi.get<{ verification: CompanyVerificationView }>(`/matchmaking/company-verification/${member.userId}`, { signal }), [member.userId]);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const decide = useAction((status: Decision) =>
    adminApi.post<{ verification: CompanyVerificationView }>(`/matchmaking/company-verification/${member.userId}`, { status, ...(note.trim() ? { note: note.trim() } : {}) })
  );

  async function run(to: Decision, confirmed = false) {
    if (to === "APPROVED" && !confirmed) {
      setConfirmApprove(true);
      return;
    }
    setConfirmApprove(false);
    setDone(null);
    const res = await decide.run(to);
    if (res) {
      view.setData(res);
      setNote("");
      setDone(`Saved: ${COMPANY_VERIFICATION_LABEL[res.verification.status]}.`);
    }
  }

  return (
    <Card
      title={member.name}
      description={`${member.profileId} · ${member.email} · profile ${member.profileCompletionPercent}% complete · account ${member.accountStatus.toLowerCase()}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onBack}>
          Choose another member
        </Button>
      }
    >
      <AsyncView {...view} skeleton={<ListSkeleton />}>
        {({ verification: v }) => (
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-rz-muted">Status:</span>
              {v.status === "APPROVED" ? <CompanyVerifiedBadge /> : <Badge tone={v.status === "PENDING" ? "gold" : "neutral"}>{COMPANY_VERIFICATION_LABEL[v.status]}</Badge>}
              {v.reviewedAt && (
                <span className="text-[12px] text-rz-muted">
                  Last decision {formatDateTime(v.reviewedAt)}
                  {v.reviewedBy ? ` by ${v.reviewedBy.name}` : ""}
                </span>
              )}
            </div>
            <p className="text-[12px] text-rz-muted">
              The badge means the team reviewed and approved this profile. It does not guarantee compatibility, character or a successful marriage, and
              choosing a member for an introduction never verifies them.
            </p>
            <div>
              <FieldLabel htmlFor="cv-note">Review note (kept in the history)</FieldLabel>
              <Textarea id="cv-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {NEXT[v.status].map((n) => (
                <Button key={n.to} size="sm" variant={n.variant} disabled={decide.pending} onClick={() => void run(n.to)}>
                  {n.label}
                </Button>
              ))}
            </div>
            <ActionError error={decide.error} />
            {done && <SuccessNote>{done}</SuccessNote>}
            <div>
              <h3 className="text-sm font-semibold text-rz-navy">History</h3>
              {v.history.length === 0 ? (
                <p className="mt-1 text-sm text-rz-muted">No review decisions yet.</p>
              ) : (
                <ol className="mt-2 space-y-2 text-sm">
                  {v.history.map((h) => (
                    <li key={h.id} className="rounded-md border border-rz-border p-2">
                      <span className="text-rz-muted">{formatDateTime(h.createdAt)}</span> — {h.from ? COMPANY_VERIFICATION_LABEL[h.from as CompanyVerificationStatus] ?? h.from : "?"} →{" "}
                      <span className="font-medium">{h.to ? COMPANY_VERIFICATION_LABEL[h.to as CompanyVerificationStatus] ?? h.to : "?"}</span>
                      {h.reviewer ? ` · ${h.reviewer.name}` : ""}
                      {h.note && <span className="mt-0.5 block whitespace-pre-wrap text-[12px] text-rz-muted">{h.note}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </AsyncView>
      {confirmApprove && (
        <ConfirmDialog
          title="Approve as Company Verified?"
          confirmLabel="Approve"
          pending={decide.pending}
          onCancel={() => setConfirmApprove(false)}
          onConfirm={() => void run("APPROVED", true)}
        >
          The “Company Verified” badge will show on {member.name}’s profile cards and profile page. It does not guarantee compatibility, character or a
          successful marriage.
        </ConfirmDialog>
      )}
    </Card>
  );
}

export function CompanyVerificationClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<AdminMemberSummary | null>(null);
  const term = useDebounced(q.trim());
  const results = useAsync(
    (signal) =>
      term.length >= 2
        ? adminApi.get<{ members: AdminMemberSummary[] }>("/matchmaking/members", { query: { q: term, scope: "all" }, signal })
        : Promise.resolve({ members: [] as AdminMemberSummary[] }),
    [term]
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <p className="text-sm text-rz-muted">A separate review by a Super Admin. Only an approved review shows the “Company Verified” badge; staff profile verification is not affected.</p>
      ) : (
        <>
          <Link href="/admin/super/matchmaking" className="inline-flex items-center gap-1 text-sm font-semibold text-rz-maroon hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Personal Matchmaking
          </Link>
          <PageHeader
            title="Company Verified"
            description="A separate review by a Super Admin. Only an approved review shows the “Company Verified” badge; staff profile verification is not affected."
          />
        </>
      )}
      {picked ? (
        <Review member={picked} onBack={() => setPicked(null)} />
      ) : (
        <Card title="Find a member">
          <div className="p-4">
            <FieldLabel htmlFor="cv-search">Member</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rz-muted" aria-hidden />
              <Input id="cv-search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, e-mail or profile ID (RZ…)" />
            </div>
            <ActionError error={results.error} />
            {term.length >= 2 && results.data && (
              <ul className="mt-2 divide-y divide-rz-border rounded-md border border-rz-border">
                {results.data.members.length === 0 && <li className="p-3 text-sm text-rz-muted">No members found.</li>}
                {results.data.members.map((m) => (
                  <li key={m.userId}>
                    <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-rz-cream" onClick={() => setPicked(m)}>
                      <span>
                        <span className="font-medium text-rz-navy">{m.name}</span>
                        <span className="block text-[12px] text-rz-muted">
                          {m.profileId} · {m.email} · account {m.accountStatus.toLowerCase()}
                        </span>
                      </span>
                      <Badge tone={m.companyVerificationStatus === "APPROVED" ? "success" : "neutral"}>{COMPANY_VERIFICATION_LABEL[m.companyVerificationStatus]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
