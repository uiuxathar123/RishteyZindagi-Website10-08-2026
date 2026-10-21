"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import {
  COMPANY_VERIFICATION_LABEL,
  INTRODUCTION_RESPONSE_LABEL,
  INTRODUCTION_STATUS_LABEL,
  type AdminIntroduction,
  type AdminMemberSummary,
  type IntroductionCandidates,
  type IntroductionCompatibility,
  type IntroductionPreview,
  type IntroductionStatus,
} from "@/lib/api/matchmaking-types";
import { formatDate } from "@/lib/format";
import { ActionError, Card, PageHeader, SuccessNote, td, th, useDebounced } from "./AdminUi";
import { ConfirmDialog } from "./ConfirmDialog";

const STATUSES = Object.keys(INTRODUCTION_STATUS_LABEL) as IntroductionStatus[];
const lower = (v: string) => v.toLowerCase().replace(/_/g, " ");

/** Everything the Super Admin needs to judge a member before choosing them — never shown to members. */
function MemberFacts({ m }: { m: AdminMemberSummary }) {
  return (
    <div className="text-[12px] text-rz-muted">
      <p>
        {m.profileId} · {m.gender === "MALE" ? "Man" : "Woman"}, {m.age} · {m.email}
      </p>
      <p className="mt-0.5">
        Profile {m.profileCompletionPercent}% complete · account {lower(m.accountStatus)} · profile {lower(m.profileStatus)} · {lower(m.approvalStatus)} ·{" "}
        {m.profileVisibility === "VISIBLE" ? "visible" : "hidden"}
        {m.matchmakingOptOut ? " · opted out of matchmaking" : ""}
      </p>
      <p className="mt-0.5">
        Blocks: made {m.blocksMade}, received {m.blocksReceived} · {COMPANY_VERIFICATION_LABEL[m.companyVerificationStatus]}
      </p>
      {m.problems.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-rz-maroon">
          {m.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberPicker({ label, value, onChange }: { label: string; value: AdminMemberSummary | null; onChange: (m: AdminMemberSummary | null) => void }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const results = useAsync(
    (signal) =>
      term.length >= 2
        ? adminApi.get<{ members: AdminMemberSummary[] }>("/matchmaking/members", { query: { q: term, scope: "introducible" }, signal })
        : Promise.resolve({ members: [] as AdminMemberSummary[] }),
    [term]
  );

  if (value) {
    return (
      <div className="rounded-md border border-rz-border p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-rz-navy">{value.name}</p>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
        <MemberFacts m={value} />
      </div>
    );
  }
  return (
    <div>
      <FieldLabel htmlFor={`pick-${label}`}>{label}</FieldLabel>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rz-muted" aria-hidden />
        <Input id={`pick-${label}`} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, e-mail or profile ID (RZ…)" />
      </div>
      <p className="mt-1 text-[12px] text-rz-muted">Only members who can be introduced are listed (active, approved, visible, not opted out, 18+).</p>
      {results.error && <ActionError error={results.error} />}
      {term.length >= 2 && results.data && (
        <ul className="mt-2 max-h-72 divide-y divide-rz-border overflow-auto rounded-md border border-rz-border">
          {results.data.members.length === 0 && <li className="p-3 text-sm text-rz-muted">No members found.</li>}
          {results.data.members.map((m) => (
            <li key={m.userId}>
              <button type="button" className="w-full p-3 text-left hover:bg-rz-cream" onClick={() => onChange(m)}>
                <span className="font-medium text-rz-navy">{m.name}</span>
                <MemberFacts m={m} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** After the first member is chosen: the members they could be introduced to now, best fit first. */
function BestMatches({ first, onPick }: { first: AdminMemberSummary; onPick: (m: AdminMemberSummary) => void }) {
  const found = useAsync(
    (signal) => adminApi.get<IntroductionCandidates>("/matchmaking/introductions/candidates", { query: { userId: first.userId }, signal }),
    [first.userId]
  );
  return (
    <div>
      <p className="text-sm font-semibold text-rz-navy">Best matches for {first.name}</p>
      <p className="text-[12px] text-rz-muted">Eligible both ways, not already matched or introduced. Best fit first.</p>
      {found.loading && !found.data && <ListSkeleton />}
      <ActionError error={found.error} />
      {found.data && (
        <>
          {!found.data.hasPreferences && (
            <p className="mt-2 rounded-md bg-rz-cream p-2 text-[12px] text-rz-muted">{first.name} has no partner preferences yet, so these are not ranked by fit.</p>
          )}
          {found.data.items.length === 0 ? (
            <p className="mt-2 text-sm text-rz-muted">No eligible members right now. Try searching by name below.</p>
          ) : (
            <ul className="mt-2 max-h-80 divide-y divide-rz-border overflow-auto rounded-md border border-rz-border">
              {found.data.items.map((c) => (
                <li key={c.member.userId} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <span className="font-medium text-rz-navy">{c.member.name}</span>
                    {c.score !== null && (
                      <Badge tone={c.tier === "PRIMARY" ? "success" : "gold"} className="ml-2">
                        {c.score}% fit
                      </Badge>
                    )}
                    <MemberFacts m={c.member} />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onPick(c.member)}>
                    Choose
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function Compatibility({ title, value }: { title: string; value: IntroductionCompatibility | null }) {
  return (
    <div>
      <p className="text-sm font-semibold text-rz-navy">
        {title}: {value ? `${value.score}%` : "not scored (no partner preferences)"}
      </p>
      {value && (
        <ul className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-rz-muted">
          {value.breakdown.map((b) => (
            <li key={b.category} className="rounded bg-rz-cream px-1.5 py-0.5">
              {b.category}: {b.result} ({Math.round(b.contribution)}/{b.weight})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateIntroduction({ onCreated }: { onCreated: () => void }) {
  const [a, setA] = useState<AdminMemberSummary | null>(null);
  const [b, setB] = useState<AdminMemberSummary | null>(null);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const preview = useAsync(
    (signal) =>
      a && b
        ? adminApi.get<{ preview: IntroductionPreview }>("/matchmaking/introductions/preview", { query: { userA: a.userId, userB: b.userId }, signal })
        : Promise.resolve(null),
    [a?.userId, b?.userId]
  );
  const create = useAction(() =>
    adminApi.post<{ introduction: AdminIntroduction }>("/matchmaking/introductions", {
      userAId: a!.userId,
      userBId: b!.userId,
      ...(message.trim() ? { messageToMembers: message.trim() } : {}),
      ...(note.trim() ? { internalNote: note.trim() } : {}),
    })
  );
  const p = preview.data?.preview ?? null;

  async function submit() {
    setDone(false);
    const res = await create.run();
    if (res) {
      setDone(true);
      setA(null);
      setB(null);
      setMessage("");
      setNote("");
      onCreated();
    }
  }

  return (
    <Card
      title="Create an introduction"
      description="Choose two members — neither needs to have bought Personal Matchmaking. Both are asked separately; nothing is matched or unlocked unless they connect through the normal interest flow."
    >
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <MemberPicker label="First member" value={a} onChange={(m) => { setA(m); setDone(false); }} />
        {!a ? (
          <div className="rounded-md border border-dashed border-rz-border p-4 text-sm text-rz-muted">
            Choose the first member — their best matches will appear here.
          </div>
        ) : b ? (
          <MemberPicker label="Second member" value={b} onChange={(m) => { setB(m); setDone(false); }} />
        ) : (
          <div className="space-y-4">
            <BestMatches first={a} onPick={(m) => { setB(m); setDone(false); }} />
            <MemberPicker label="Or search for the second member" value={null} onChange={(m) => { setB(m); setDone(false); }} />
          </div>
        )}
      </div>
      {a && b && (
        <div className="space-y-4 border-t border-rz-border p-4">
          {preview.loading && <ListSkeleton />}
          <ActionError error={preview.error} />
          {p && (
            <>
              {p.eligible ? (
                <Badge tone="success">These members can be introduced</Badge>
              ) : (
                <div role="alert" className="rounded-md border border-rz-maroon/30 bg-rz-maroon/5 p-3 text-sm text-rz-maroon">
                  <p className="font-semibold">These members cannot be introduced:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {p.problems.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[12px] text-rz-muted">
                Blocks between them: {p.blocks.aBlockedB || p.blocks.bBlockedA ? "yes" : "none"} · Already matched: {p.alreadyMatched ? "yes" : "no"} · Open introduction:{" "}
                {p.openIntroductionId ? "yes" : "no"}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Compatibility title={`For ${p.members.a.name}`} value={p.compatibility.aToB} />
                <Compatibility title={`For ${p.members.b.name}`} value={p.compatibility.bToA} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="intro-message">Message to both members (optional)</FieldLabel>
                  <Textarea id="intro-message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown to both. Never include contact details." />
                </div>
                <div>
                  <FieldLabel htmlFor="intro-note">Internal note (optional)</FieldLabel>
                  <Textarea id="intro-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only Super Admins see this." />
                </div>
              </div>
              <ActionError error={create.error} />
              <Button disabled={!p.eligible || create.pending} onClick={() => void submit()}>
                Send introduction to both members
              </Button>
            </>
          )}
        </div>
      )}
      {done && (
        <div className="px-4 pb-4">
          <SuccessNote>Introduction sent. Both members were notified and can accept or decline.</SuccessNote>
        </div>
      )}
    </Card>
  );
}

function ResponseCell({ name, response, at }: { name: string; response: AdminIntroduction["userA"]["response"]; at: string | null }) {
  return (
    <span className="block">
      <span className="font-medium text-rz-text">{name}</span>
      <span className="block text-[11px] text-rz-muted">
        {INTRODUCTION_RESPONSE_LABEL[response]}
        {at ? ` · ${formatDate(at)}` : ""}
      </span>
    </span>
  );
}

export function MatchmakingIntroductionsClient({ embedded = false, initialStatus = "" }: { embedded?: boolean; initialStatus?: IntroductionStatus | "" } = {}) {
  const [status, setStatus] = useState<string>(initialStatus);
  useEffect(() => setStatus(initialStatus), [initialStatus]);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminIntroduction | null>(null);
  const list = useAsync(
    (signal) => adminApi.get<{ items: AdminIntroduction[]; total: number }>("/matchmaking/introductions", { query: { status: status || undefined, pageSize: 100 }, signal }),
    [status]
  );
  const withdraw = useAction((id: string) => adminApi.post<{ introduction: AdminIntroduction }>(`/matchmaking/introductions/${id}/withdraw`));

  return (
    <div className="space-y-6">
      {!embedded && (
        <>
          <Link href="/admin/super/matchmaking" className="inline-flex items-center gap-1 text-sm font-semibold text-rz-maroon hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Personal Matchmaking
          </Link>
          <PageHeader title="Introductions" description="Super Admin introductions between two members. Each member accepts or declines on their own." />
        </>
      )}
      <CreateIntroduction onCreated={() => list.reload()} />
      <Card
        title="Introductions"
        actions={
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {INTRODUCTION_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      >
        {done && (
          <div className="px-4 pt-4">
            <SuccessNote>{done}</SuccessNote>
          </div>
        )}
        <ActionError error={withdraw.error} className="mx-4 mt-4" />
        <AsyncView {...list} skeleton={<ListSkeleton />}>
          {(data) =>
            data.items.length === 0 ? (
              <p className="p-6 text-center text-sm text-rz-muted">No introductions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-rz-border">
                      <th className={th}>Member</th>
                      <th className={th}>Member</th>
                      <th className={th}>Status</th>
                      <th className={th}>Scores</th>
                      <th className={th}>Created</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => {
                      const open = i.status === "PENDING" || i.status === "MUTUALLY_ACCEPTED";
                      return (
                        <tr key={i.id} className="border-b border-rz-border last:border-0">
                          <td className={td}>
                            <ResponseCell name={i.userA.name} response={i.userA.response} at={i.userA.respondedAt} />
                          </td>
                          <td className={td}>
                            <ResponseCell name={i.userB.name} response={i.userB.response} at={i.userB.respondedAt} />
                          </td>
                          <td className={td}>
                            <Badge tone={i.status === "MUTUALLY_ACCEPTED" ? "success" : i.status === "PENDING" ? "gold" : "neutral"}>{INTRODUCTION_STATUS_LABEL[i.status]}</Badge>
                            {i.internalNote && <span className="mt-1 block max-w-xs whitespace-pre-wrap text-[11px] text-rz-muted">Note: {i.internalNote}</span>}
                          </td>
                          <td className={td}>
                            {i.scoreAToB ?? "—"} / {i.scoreBToA ?? "—"}
                          </td>
                          <td className={td}>{formatDate(i.createdAt)}</td>
                          <td className={td}>
                            {open && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={withdraw.pending}
                                onClick={() => setConfirming(i)}
                              >
                                Withdraw
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </AsyncView>
      </Card>
      {confirming && (
        <ConfirmDialog
          title="Withdraw this introduction?"
          confirmLabel="Withdraw introduction"
          danger
          pending={withdraw.pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setDone(null);
            void withdraw.run(confirming.id).then((r) => {
              setConfirming(null);
              if (r) {
                setDone("Introduction withdrawn.");
                list.reload();
              }
            });
          }}
        >
          {confirming.userA.name} and {confirming.userB.name} will both be told this introduction is no longer active. They are not told who withdrew it.
        </ConfirmDialog>
      )}
    </div>
  );
}
