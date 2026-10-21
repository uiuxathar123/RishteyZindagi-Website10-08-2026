"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import {
  CASE_STATUS_LABEL,
  type AdminCaseDetail,
  type AdminRecommendation,
  type ScoreBreakdownEntry,
  type SuggestedProfile,
} from "@/lib/api/matchmaking-types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ActionError, Card, PageHeader, SuccessNote } from "./AdminUi";
import { ConfirmDialog } from "./ConfirmDialog";

function profileLine(p: SuggestedProfile | null) {
  if (!p) return "Profile not shown (no longer eligible)";
  return [p.displayName, p.age ? `${p.age} yrs` : null, p.religion, p.city ?? null, p.profession, p.profileId].filter(Boolean).join(" · ");
}

function Breakdown({ items }: { items: ScoreBreakdownEntry[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-rz-muted">
      {items.map((b) => (
        <li key={b.category} className="rounded bg-rz-cream px-1.5 py-0.5">
          {b.category}: {b.result} ({Math.round(b.contribution)}/{b.weight})
        </li>
      ))}
    </ul>
  );
}

export function MatchmakingCaseClient({ caseId }: { caseId: string }) {
  const detail = useAsync((signal) => adminApi.get<AdminCaseDetail>(`/matchmaking/cases/${caseId}`, { signal }), [caseId]);
  const [showRecos, setShowRecos] = useState(false);
  const recos = useAsync(
    (signal) =>
      showRecos
        ? adminApi.get<{ status: "ok" | "preferences_not_configured"; items: AdminRecommendation[] }>(`/matchmaking/cases/${caseId}/recommendations`, { signal })
        : Promise.resolve(null),
    [caseId, showRecos]
  );
  const [note, setNote] = useState("");
  const [noteVisible, setNoteVisible] = useState(false);
  const [manualId, setManualId] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const addNote = useAction(() => adminApi.post(`/matchmaking/cases/${caseId}/notes`, { note, customerVisible: noteVisible }));
  const setStatus = useAction((status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => adminApi.post(`/matchmaking/cases/${caseId}/status`, { status }));
  const addSuggestion = useAction((candidateUserId: string, source: "AUTO" | "MANUAL") =>
    adminApi.post(`/matchmaking/cases/${caseId}/suggestions`, { candidateUserId, source })
  );
  const act = useAction((suggestionId: string, action: "APPROVE" | "SEND" | "WITHDRAW") => adminApi.post(`/matchmaking/suggestions/${suggestionId}`, { action }));

  function after(message: string) {
    setDone(message);
    detail.reload();
    if (showRecos) recos.reload();
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/super/matchmaking" className="inline-flex items-center gap-1 text-sm font-semibold text-rz-maroon hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All cases
      </Link>
      <AsyncView {...detail} skeleton={<ListSkeleton />}>
        {(d) => {
          const c = d.case;
          const workable = c.status === "ACTIVE" || c.status === "IN_PROGRESS";
          return (
            <>
              <PageHeader title={d.customer ? d.customer.name : "Case"} description={d.customer ? d.customer.email : undefined} actions={<Badge tone={workable ? "success" : "neutral"}>{CASE_STATUS_LABEL[c.status]}</Badge>} />
              {done && <SuccessNote>{done}</SuccessNote>}
              <ActionError error={setStatus.error ?? addNote.error ?? addSuggestion.error ?? act.error} />
              {d.duplicateCaptures > 0 && (
                <div role="alert" className="rounded-xl border border-rz-maroon/30 bg-rz-maroon/5 p-4 text-sm text-rz-maroon">
                  <p className="font-semibold">
                    {d.duplicateCaptures === 1 ? "This member was charged twice." : `This member was charged ${d.duplicateCaptures + 1} times.`}
                  </p>
                  <p className="mt-1">
                    {d.duplicateCaptures === 1 ? "A second payment" : "Extra payments"} for this case {d.duplicateCaptures === 1 ? "was" : "were"} captured after it was already paid. Nothing extra was granted. Refund the flagged{" "}
                    {d.duplicateCaptures === 1 ? "payment" : "payments"} below from{" "}
                    <Link href="/admin/super/revenue" className="font-semibold underline">Revenue</Link>.
                  </p>
                </div>
              )}

              <Card title="Case">
                <dl className="grid gap-3 p-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-rz-muted">Paid</dt><dd>{c.complimentary ? "Complimentary — no payment" : c.paidAt ? `${formatMoney(c.priceInPaise, c.currency)} on ${formatDate(c.paidAt)}` : "Not yet"}</dd></div>
                  <div><dt className="text-rz-muted">Included access</dt><dd>{c.includedAccessRevokedAt ? "Revoked (refund)" : c.includedAccessUntil ? `Until ${formatDate(c.includedAccessUntil)}` : `${c.includedMembershipDays} days after payment`}</dd></div>
                  <div><dt className="text-rz-muted">Consent</dt><dd>{formatDateTime(c.consentedAt)} (v{c.consentVersion})</dd></div>
                  <div><dt className="text-rz-muted">Profile</dt><dd>{d.customerProfile ? `${d.customerProfile.profileId} · ${d.customerProfile.profileStatus}${d.customerProfile.hasPreferences ? "" : " · no partner preferences yet"}` : "No profile"}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-rz-muted">Customer notes</dt><dd className="whitespace-pre-wrap">{c.customerNotes || "—"}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2 px-4 pb-4">
                  {c.status === "ACTIVE" && <Button size="sm" disabled={setStatus.pending} onClick={() => void setStatus.run("IN_PROGRESS").then((r) => r && after("Marked in progress."))}>Mark in progress</Button>}
                  {workable && <Button size="sm" variant="outline" disabled={setStatus.pending} onClick={() => void setStatus.run("COMPLETED").then((r) => r && after("Case completed and closed."))}>Complete and close</Button>}
                  {workable && <Button size="sm" variant="ghost" disabled={setStatus.pending} onClick={() => setConfirmCancel(true)}>Cancel case</Button>}
                </div>
              </Card>

              <Card title="Payments" description="Every payment attempt for this case. Only one payment can pay for a case.">
                <ul className="divide-y divide-rz-border">
                  {d.payments.length === 0 && <li className="p-4 text-sm text-rz-muted">No payment attempts.</li>}
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-rz-text">{formatMoney(p.amountInPaise, p.currency)} · {p.status}</p>
                        <p className="break-all text-[12px] text-rz-muted">
                          {p.id} · started {formatDateTime(p.createdAt)}
                          {p.verifiedAt ? ` · verified ${formatDateTime(p.verifiedAt)}` : ""}
                        </p>
                      </div>
                      {p.isPaidPayment && <Badge tone="success">Paid for this case</Badge>}
                      {p.duplicateCapture && <Badge tone="maroon">Duplicate — refund</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Suggestions" description="Approve, then send: only sent suggestions are shown to the member. Eligibility is re-checked at every step.">
                <ul className="divide-y divide-rz-border">
                  {d.suggestions.length === 0 && <li className="p-4 text-sm text-rz-muted">No suggestions yet.</li>}
                  {d.suggestions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-rz-text">{profileLine(s.candidate)}</p>
                        <p className="text-[12px] text-rz-muted">
                          {s.source} · {s.status}
                          {s.score !== null ? ` · score ${s.score}` : ""}
                          {s.response !== "PENDING" ? ` · member: ${s.response === "INTERESTED" ? "interested" : "not interested"}` : ""}
                          {!s.candidateEligibleNow && s.status !== "WITHDRAWN" ? " · no longer eligible" : ""}
                        </p>
                        <Breakdown items={s.scoreBreakdown} />
                      </div>
                      <div className="flex gap-2">
                        {s.status === "PROPOSED" && workable && <Button size="sm" variant="outline" disabled={act.pending} onClick={() => void act.run(s.id, "APPROVE").then((r) => r && after("Suggestion approved."))}>Approve</Button>}
                        {s.status === "APPROVED" && workable && <Button size="sm" disabled={act.pending} onClick={() => void act.run(s.id, "SEND").then((r) => r && after("Suggestion sent to the member."))}>Send</Button>}
                        {s.status !== "WITHDRAWN" && <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => void act.run(s.id, "WITHDRAW").then((r) => r && after("Suggestion withdrawn."))}>Withdraw</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
                {workable && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-rz-border p-4">
                    <div className="min-w-[280px] flex-1">
                      <FieldLabel htmlFor="mm-manual">Add a member manually (member user id)</FieldLabel>
                      <Input id="mm-manual" value={manualId} onChange={(e) => setManualId(e.target.value.trim())} placeholder="00000000-0000-0000-0000-000000000000" />
                    </div>
                    <Button size="sm" variant="outline" disabled={!manualId || addSuggestion.pending} onClick={() => void addSuggestion.run(manualId, "MANUAL").then((r) => { if (r) { setManualId(""); after("Added to the case."); } })}>
                      Add
                    </Button>
                  </div>
                )}
              </Card>

              {workable && (
                <Card title="Automatic recommendations" description="The eligible pool for this member, scored with the live matching weights. Profiles already on the case are left out.">
                  {!showRecos ? (
                    <div className="p-4"><Button size="sm" onClick={() => setShowRecos(true)}>Generate recommendations</Button></div>
                  ) : (
                    <AsyncView {...recos} skeleton={<ListSkeleton />}>
                      {(r) =>
                        !r ? null : r.status === "preferences_not_configured" ? (
                          <p className="p-4 text-sm text-rz-muted">The member has no partner preferences yet, so there is nothing to score against. Manual selection still works.</p>
                        ) : r.items.length === 0 ? (
                          <p className="p-4 text-sm text-rz-muted">No eligible profiles left to recommend.</p>
                        ) : (
                          <ul className="divide-y divide-rz-border">
                            {r.items.map((item) => (
                              <li key={item.candidateUserId} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                                <div className="min-w-0">
                                  <p className="font-medium text-rz-text">{profileLine(item.candidate)}</p>
                                  <p className="text-[12px] text-rz-muted">score {item.score}{item.tier ? ` · ${item.tier.toLowerCase()}` : ""}</p>
                                  <Breakdown items={item.breakdown} />
                                </div>
                                <Button size="sm" variant="outline" disabled={addSuggestion.pending} onClick={() => void addSuggestion.run(item.candidateUserId, "AUTO").then((res) => res && after("Added to the case."))}>
                                  Add to case
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )
                      }
                    </AsyncView>
                  )}
                </Card>
              )}

              <Card title="Notes and history">
                <div className="space-y-2 p-4">
                  <textarea aria-label="New note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className="rz-focus w-full rounded-md border border-rz-border p-3 text-sm" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} /> Visible to the member
                  </label>
                  <Button size="sm" disabled={!note.trim() || addNote.pending} onClick={() => void addNote.run().then((r) => { if (r) { setNote(""); setNoteVisible(false); after("Note added."); } })}>
                    Add note
                  </Button>
                </div>
                <ol className="divide-y divide-rz-border border-t border-rz-border text-sm">
                  {[...d.events].reverse().map((e) => (
                    <li key={e.id} className="p-4">
                      <p className="text-[12px] text-rz-muted">
                        {formatDateTime(e.createdAt)} · {e.actorType} · {e.kind}
                        {e.toStatus ? ` · ${e.fromStatus ?? ""} → ${e.toStatus}` : ""}
                        {e.customerVisible ? " · visible to member" : " · internal"}
                      </p>
                      {e.note && <p className="mt-1 whitespace-pre-wrap">{e.note}</p>}
                    </li>
                  ))}
                </ol>
              </Card>
            </>
          );
        }}
      </AsyncView>
      {confirmCancel && (
        <ConfirmDialog
          title="Cancel and close this case?"
          confirmLabel="Cancel case"
          danger
          pending={setStatus.pending}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() =>
            void setStatus.run("CANCELLED").then((r) => {
              setConfirmCancel(false);
              if (r) after("Case cancelled.");
            })
          }
        >
          The case is closed and no more suggestions can be sent. This does not refund the payment — refund it from Revenue if needed.
        </ConfirmDialog>
      )}
    </div>
  );
}
