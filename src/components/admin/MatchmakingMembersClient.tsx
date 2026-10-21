"use client";

import { useEffect, useState } from "react";
import { Gift, Search, Send, Users } from "lucide-react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import {
  CASE_STATUS_LABEL,
  COMPANY_VERIFICATION_LABEL,
  INVITATION_STATUS_LABEL,
  type AdminIntroduction,
  type AdminInvitation,
  type DirectoryFilter,
  type DirectoryMember,
  type IntroductionPreview,
  type InvitationKind,
  type InvitationStatus,
  type MatchmakingSettings,
} from "@/lib/api/matchmaking-types";
import { formatDate } from "@/lib/format";
import { ActionError, Card, Modal, Pagination, SuccessNote, useDebounced } from "./AdminUi";
import { ConfirmDialog } from "./ConfirmDialog";
import { Compatibility } from "./MatchmakingIntroductionsClient";

const PAGE_SIZE = 25;
const FILTERS: Array<{ key: DirectoryFilter; label: string }> = [
  { key: "all", label: "All members" },
  { key: "introducible", label: "Can be introduced" },
  { key: "in_matchmaking", label: "In Personal Matchmaking" },
  { key: "no_profile", label: "No profile yet" },
];
const lower = (v: string) => v.toLowerCase().replace(/_/g, " ");

/** Where the member stands with Personal Matchmaking, as one short badge. */
function MatchmakingState({ m }: { m: DirectoryMember }) {
  const s = m.matchmaking;
  if (s.openCaseStatus) {
    return <Badge tone={s.openCaseStatus === "PENDING_PAYMENT" ? "gold" : "success"}>{s.complimentary ? "Complimentary case" : `Case: ${CASE_STATUS_LABEL[s.openCaseStatus]}`}</Badge>;
  }
  if (s.pendingInvitationKind) return <Badge tone="gold">{s.pendingInvitationKind === "COMPLIMENTARY" ? "Free offer sent" : "Invited"}</Badge>;
  return null;
}

function MemberLine({ m }: { m: DirectoryMember }) {
  const p = m.profile;
  return (
    <div className="min-w-0 text-[12px] text-rz-muted">
      <p className="truncate">{m.email}</p>
      {p ? (
        <>
          <p>
            {p.profileId} · {p.gender === "MALE" ? "Man" : "Woman"}, {p.age} · profile {p.profileCompletionPercent}% complete
          </p>
          <p>
            Account {lower(m.accountStatus)} · {lower(p.profileStatus)} · {lower(p.approvalStatus)} · {p.profileVisibility === "VISIBLE" ? "visible" : "hidden"}
            {p.matchmakingOptOut ? " · opted out" : ""} · blocks {m.blocksMade}/{m.blocksReceived} · {COMPANY_VERIFICATION_LABEL[p.companyVerificationStatus]}
          </p>
        </>
      ) : (
        <p>No profile yet · account {lower(m.accountStatus)} · joined {formatDate(m.joinedAt)}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ invite

function InviteDialog({ member, onClose, onSent }: { member: DirectoryMember; onClose: () => void; onSent: () => void }) {
  const settings = useAsync((signal) => adminApi.get<{ settings: MatchmakingSettings }>("/matchmaking/settings", { signal }), []);
  const [kind, setKind] = useState<InvitationKind>("OFFER");
  const [days, setDays] = useState<string>("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (settings.data && days === "") setDays(String(settings.data.settings.includedMembershipDays));
  }, [settings.data, days]);
  const send = useAction(() =>
    adminApi.post<{ invitation: AdminInvitation }>("/matchmaking/invitations", {
      userId: member.userId,
      kind,
      ...(kind === "COMPLIMENTARY" ? { includedMembershipDays: Number(days) } : {}),
      ...(message.trim() ? { messageToMember: message.trim() } : {}),
    })
  );
  const daysValid = kind === "OFFER" || (/^\d+$/.test(days) && Number(days) <= 3650);

  return (
    <Modal
      title={`Invite ${member.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.pending}>
            Cancel
          </Button>
          <Button
            disabled={send.pending || !daysValid}
            onClick={() =>
              void send.run().then((r) => {
                if (r) onSent();
              })
            }
          >
            Send invitation
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-semibold text-rz-navy">What to offer</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" className="mt-1" checked={kind === "OFFER"} onChange={() => setKind("OFFER")} />
          <span>
            <span className="font-medium text-rz-navy">Invitation</span>
            <span className="block text-[12px] text-rz-muted">The member is told about the service and buys it at the normal price if they want.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" className="mt-1" checked={kind === "COMPLIMENTARY"} onChange={() => setKind("COMPLIMENTARY")} />
          <span>
            <span className="font-medium text-rz-navy">Complimentary (free)</span>
            <span className="block text-[12px] text-rz-muted">Free service. It starts only when the member accepts it and gives consent. No payment, no invoice.</span>
          </span>
        </label>
      </fieldset>
      {kind === "COMPLIMENTARY" && (
        <div className="mt-3">
          <FieldLabel htmlFor="invite-days">Included member access (days)</FieldLabel>
          <Input id="invite-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.trim())} />
          <p className="mt-1 text-[12px] text-rz-muted">Interests and chat access. 0 = the service only, no member access.</p>
          {!daysValid && <p className="mt-1 text-[12px] text-rz-maroon">Enter a whole number from 0 to 3650.</p>}
        </div>
      )}
      <div className="mt-3">
        <FieldLabel htmlFor="invite-message">Message to the member (optional)</FieldLabel>
        <Textarea id="invite-message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown with the invitation. Never include contact details." />
      </div>
      <ActionError error={send.error} className="mt-3" />
    </Modal>
  );
}

// ------------------------------------------------------------------ introduce two ticked members

function IntroduceDialog({ a, b, onClose, onSent }: { a: DirectoryMember; b: DirectoryMember; onClose: () => void; onSent: () => void }) {
  const preview = useAsync(
    (signal) => adminApi.get<{ preview: IntroductionPreview }>("/matchmaking/introductions/preview", { query: { userA: a.userId, userB: b.userId }, signal }),
    [a.userId, b.userId]
  );
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const send = useAction(() =>
    adminApi.post<{ introduction: AdminIntroduction }>("/matchmaking/introductions", {
      userAId: a.userId,
      userBId: b.userId,
      ...(message.trim() ? { messageToMembers: message.trim() } : {}),
      ...(note.trim() ? { internalNote: note.trim() } : {}),
    })
  );
  const p = preview.data?.preview ?? null;

  return (
    <Modal
      variant="drawer"
      title={`Introduce ${a.name} and ${b.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.pending}>
            Cancel
          </Button>
          <Button
            disabled={!p?.eligible || send.pending}
            onClick={() =>
              void send.run().then((r) => {
                if (r) onSent();
              })
            }
          >
            Send introduction to both
          </Button>
        </>
      }
    >
      {preview.loading && !p && <ListSkeleton />}
      <ActionError error={preview.error} />
      {p && (
        <div className="space-y-4 text-sm">
          {p.eligible ? (
            <Badge tone="success">These members can be introduced</Badge>
          ) : (
            <div role="alert" className="rounded-md border border-rz-maroon/30 bg-rz-maroon/5 p-3 text-rz-maroon">
              <p className="font-semibold">These members cannot be introduced:</p>
              <ul className="mt-1 list-disc pl-5">
                {p.problems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12px] text-rz-muted">
            Blocks between them: {p.blocks.aBlockedB || p.blocks.bBlockedA ? "yes" : "none"} · Already matched: {p.alreadyMatched ? "yes" : "no"} · Open
            introduction: {p.openIntroductionId ? "yes" : "no"}
          </p>
          <Compatibility title={`For ${p.members.a.name}`} value={p.compatibility.aToB} />
          <Compatibility title={`For ${p.members.b.name}`} value={p.compatibility.bToA} />
          <div>
            <FieldLabel htmlFor="mi-message">Message to both members (optional)</FieldLabel>
            <Textarea id="mi-message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown to both. Never include contact details." />
          </div>
          <div>
            <FieldLabel htmlFor="mi-note">Internal note (optional)</FieldLabel>
            <Textarea id="mi-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only Super Admins see this." />
          </div>
          <p className="text-[12px] text-rz-muted">Both members are asked separately. Nothing is matched and no chat opens unless they connect through the normal interest flow.</p>
          <ActionError error={send.error} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ invitations list

function InvitationsCard({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState<string>("PENDING");
  const list = useAsync(
    (signal) => adminApi.get<{ items: AdminInvitation[]; total: number }>("/matchmaking/invitations", { query: { status: status || undefined, pageSize: 100 }, signal }),
    [status, reloadKey]
  );
  const revoke = useAction((id: string) => adminApi.post<{ invitation: AdminInvitation }>(`/matchmaking/invitations/${id}/revoke`));
  const [confirming, setConfirming] = useState<AdminInvitation | null>(null);

  return (
    <Card
      title="Invitations"
      actions={
        <Select aria-label="Filter invitations" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {(Object.keys(INVITATION_STATUS_LABEL) as InvitationStatus[]).map((s) => (
            <option key={s} value={s}>
              {INVITATION_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      }
    >
      <ActionError error={revoke.error} className="mx-4 mt-4" />
      <AsyncView {...list} skeleton={<ListSkeleton />}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-rz-muted">No invitations here.</p>
          ) : (
            <ul className="divide-y divide-rz-border">
              {data.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-rz-navy">{i.member.name}</p>
                    <p className="text-[12px] text-rz-muted">
                      {i.kind === "COMPLIMENTARY" ? `Complimentary · ${i.includedMembershipDays ?? 0} days access` : "Invitation (normal price)"} · sent {formatDate(i.createdAt)}
                      {i.respondedAt ? ` · ${INVITATION_STATUS_LABEL[i.status].toLowerCase()} ${formatDate(i.respondedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={i.status === "ACCEPTED" ? "success" : i.status === "PENDING" ? "gold" : "neutral"}>{INVITATION_STATUS_LABEL[i.status]}</Badge>
                    {i.status === "PENDING" && (
                      <Button size="sm" variant="ghost" disabled={revoke.pending} onClick={() => setConfirming(i)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
      {confirming && (
        <ConfirmDialog
          title="Revoke this invitation?"
          confirmLabel="Revoke invitation"
          danger
          pending={revoke.pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() =>
            void revoke.run(confirming.id).then((r) => {
              setConfirming(null);
              if (r) list.reload();
            })
          }
        >
          {confirming.member.name} will no longer see this invitation. A case they already started is not affected.
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ the members tab

/** Every member account: tick two to introduce them, or invite one to Personal Matchmaking. */
export function MatchmakingMembersClient() {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [gender, setGender] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DirectoryMember[]>([]);
  const [inviting, setInviting] = useState<DirectoryMember | null>(null);
  const [introducing, setIntroducing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => setPage(1), [term, filter, gender]);

  const list = useAsync(
    (signal) =>
      adminApi.get<{ items: DirectoryMember[]; total: number }>("/matchmaking/directory", {
        query: { q: term || undefined, filter, gender: gender || undefined, page, pageSize: PAGE_SIZE },
        signal,
      }),
    [term, filter, gender, page, reloadKey]
  );

  function toggle(m: DirectoryMember) {
    setDone(null);
    setSelected((cur) => (cur.some((x) => x.userId === m.userId) ? cur.filter((x) => x.userId !== m.userId) : cur.length >= 2 ? cur : [...cur, m]));
  }
  const refresh = (message: string) => {
    setDone(message);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <Card title="Members" description="Every member account. Tick two members to introduce them, or invite one member to Personal Matchmaking.">
        <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rz-muted" aria-hidden />
            <Input aria-label="Search members" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, e-mail or profile ID (RZ…)" />
          </div>
          <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as DirectoryFilter)}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Any gender</option>
            <option value="MALE">Men</option>
            <option value="FEMALE">Women</option>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-rz-border bg-rz-cream px-4 py-3 text-sm" aria-live="polite">
          <span className="flex items-center gap-2 text-rz-navy">
            <Users className="h-4 w-4" aria-hidden />
            {selected.length === 0 ? "Tick two members to introduce them." : selected.length === 1 ? `${selected[0].name} selected — tick one more.` : `${selected[0].name} and ${selected[1].name} selected.`}
          </span>
          <span className="flex gap-2">
            {selected.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            )}
            <Button size="sm" disabled={selected.length !== 2} onClick={() => setIntroducing(true)} icon={<Send className="h-4 w-4" />}>
              Check and introduce
            </Button>
          </span>
        </div>
        {done && (
          <div className="px-4 pt-4">
            <SuccessNote>{done}</SuccessNote>
          </div>
        )}

        <AsyncView {...list} skeleton={<ListSkeleton />} isEmpty={(d) => d.items.length === 0} empty={{ title: "No members found", description: "Try another search or filter." }}>
          {(data) => (
            <>
              <ul className="divide-y divide-rz-border">
                {data.items.map((m) => {
                  const checked = selected.some((x) => x.userId === m.userId);
                  const canTick = m.introducible && (checked || selected.length < 2);
                  return (
                    <li key={m.userId} className="flex items-start gap-3 p-4">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        aria-label={`Select ${m.name} for an introduction`}
                        checked={checked}
                        disabled={!canTick}
                        title={m.introducible ? undefined : m.introductionProblems.join(" ")}
                        onChange={() => toggle(m)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-rz-navy">{m.name}</span>
                          <MatchmakingState m={m} />
                        </div>
                        <MemberLine m={m} />
                        {!m.introducible && <p className="mt-1 text-[12px] text-rz-maroon">Cannot be introduced: {m.introductionProblems.join(" ")}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!m.invitable}
                        title={m.invitable ? undefined : m.invitationProblems.join(" ")}
                        onClick={() => {
                          setDone(null);
                          setInviting(m);
                        }}
                        icon={<Gift className="h-4 w-4" />}
                      >
                        Invite
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <Pagination page={page} totalPages={Math.max(1, Math.ceil(data.total / PAGE_SIZE))} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} disabled={list.loading} />
            </>
          )}
        </AsyncView>
      </Card>

      <InvitationsCard reloadKey={reloadKey} />

      {inviting && (
        <InviteDialog
          member={inviting}
          onClose={() => setInviting(null)}
          onSent={() => {
            refresh(`Invitation sent to ${inviting.name}.`);
            setInviting(null);
          }}
        />
      )}
      {introducing && selected.length === 2 && (
        <IntroduceDialog
          a={selected[0]}
          b={selected[1]}
          onClose={() => setIntroducing(false)}
          onSent={() => {
            refresh(`Introduction sent to ${selected[0].name} and ${selected[1].name}.`);
            setIntroducing(false);
            setSelected([]);
          }}
        />
      )}
    </div>
  );
}
