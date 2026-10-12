"use client";

import { Avatar } from "@/components/ui/Avatar";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { AdminUserSummary, Page } from "@/lib/api/types";
import { formatDate, formatDateTime, humanize, timeAgo } from "@/lib/format";
import { photoSrc } from "@/lib/photo";
import { MapPin, Search, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, fieldIssue, KeyValue, Modal, NotAvailable, PageHeader, Pagination, ShortId, SuccessNote, td, th, useDebounced } from "./AdminUi";
import type { AdminUserDetailFull, AdminWarningCategory } from "./adminTypes";
import { ModerationPanel } from "./ModerationPanel";
import { VerifyControls } from "./VerifyControls";

type Tone = "success" | "gold" | "maroon" | "neutral" | "navy";

export const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "maroon",
  BLOCKED: "maroon",
  DELETED_PENDING: "gold",
  DELETED: "neutral",
};

const VERIFICATION_TONE: Record<string, Tone> = {
  VERIFIED: "success",
  PENDING: "gold",
  REJECTED: "maroon",
  UNVERIFIED: "neutral",
};

const PAGE_SIZE = 20;

/** `/admin/users` — search, filter and page through members; open one to review or act. */
export function UsersClient({ initialUserId }: { initialUserId?: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [verification, setVerification] = useState("");
  const [membership, setMembership] = useState("");
  const [openReports, setOpenReports] = useState(false);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(initialUserId ?? null);
  const q = useDebounced(query.trim());

  useEffect(() => setPage(1), [q, status, verification, membership, openReports, sort]);

  const list = useAsync(
    (signal) =>
      adminApi.get<Page<AdminUserSummary>>("/users", {
        query: {
          q: q || undefined,
          status: status || undefined,
          verificationStatus: verification || undefined,
          membership: membership || undefined,
          openReports: openReports ? "true" : undefined,
          sort: sort !== "newest" ? sort : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
        signal,
      }),
    [q, status, verification, membership, openReports, sort, page]
  );

  return (
    <div>
      <PageHeader
        title="Users"
        description={list.data ? `${list.data.total.toLocaleString("en-IN")} member${list.data.total === 1 ? "" : "s"} match` : "Member accounts"}
        icon={<Users className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_200px] sm:items-end">
        <div>
          <FieldLabel htmlFor="admin-user-search">Search</FieldLabel>
          <Input id="admin-user-search" placeholder="Name, email, mobile, profile ID (RZ…) or user ID…" icon={<Search className="h-4 w-4" />} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="admin-user-status">Account status</FieldLabel>
          <Select id="admin-user-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="BLOCKED">Blocked</option>
            <option value="DELETED_PENDING">Deletion pending</option>
            <option value="DELETED">Deleted</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="admin-user-verification">Verification</FieldLabel>
          <Select id="admin-user-verification" value={verification} onChange={(e) => setVerification(e.target.value)}>
            <option value="">Any</option>
            <option value="PENDING">Pending review</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
            <option value="UNVERIFIED">Unverified</option>
          </Select>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[200px_200px_auto] sm:items-end">
        <div>
          <FieldLabel htmlFor="admin-user-membership">Membership</FieldLabel>
          <Select id="admin-user-membership" value={membership} onChange={(e) => setMembership(e.target.value)}>
            <option value="">Any</option>
            <option value="ACTIVE">Has an active plan</option>
            <option value="NONE">No active plan</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="admin-user-sort">Sort by</FieldLabel>
          <Select id="admin-user-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name (A–Z)</option>
            <option value="lastActive">Recently active</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-rz-text">
          <input type="checkbox" className="rz-focus h-4 w-4 accent-rz-maroon" checked={openReports} onChange={(e) => setOpenReports(e.target.checked)} />
          Only members with open reports
        </label>
      </div>

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={6} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No users found", description: "Try a different search term or clear the filters." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Member</th>
                    <th className={th}>Email</th>
                    <th className={th}>Location</th>
                    <th className={th}>Status</th>
                    <th className={th}>Verification</th>
                    <th className={th}>Last active</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id} className="border-b border-rz-border last:border-0">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar src={photoSrc(u.primaryPhotoUrl, "admin")} alt={u.primaryPhotoUrl ? `Photo of ${u.name}` : u.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block font-medium text-rz-text">{u.name}</span>
                            {u.profileId && <span className="block text-[11px] tracking-wide text-rz-muted">{u.profileId}</span>}
                          </span>
                        </div>
                      </td>
                      <td className={`${td} text-rz-muted`}>{u.email}</td>
                      <td className={`${td} text-rz-muted`}>
                        {u.city || u.country ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {[u.city, u.country].filter(Boolean).join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={td}>
                        <Badge tone={STATUS_TONE[u.status] ?? "neutral"}>{humanize(u.status)}</Badge>
                      </td>
                      <td className={td}>
                        {u.verificationStatus ? (
                          <Badge tone={VERIFICATION_TONE[u.verificationStatus] ?? "neutral"}>
                            {u.verificationStatus === "VERIFIED" && <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />}
                            {humanize(u.verificationStatus)}
                          </Badge>
                        ) : (
                          <span className="text-rz-muted">No profile</span>
                        )}
                      </td>
                      <td className={`${td} text-rz-muted`}>{u.lastActiveAt ? timeAgo(u.lastActiveAt) : "—"}</td>
                      <td className={td}>
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelected(u.id)} aria-label={`Open ${u.name}`}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>

      {selected && <UserDrawer userId={selected} onClose={() => setSelected(null)} onChanged={list.reload} />}
    </div>
  );
}

function UserDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync((signal) => adminApi.get<{ user: AdminUserDetailFull }>(`/users/${userId}`, { signal }), [userId]);
  const { can } = useAdminSession();
  const u = detail.data?.user;

  function refresh() {
    detail.reload();
    onChanged();
  }

  return (
    <Modal title={u ? u.account.name : "Member"} variant="drawer" onClose={onClose}>
      <AsyncView data={detail.data} error={detail.error} loading={detail.loading} reload={detail.reload} skeleton={<ListSkeleton rows={5} />}>
        {({ user }) => {
          return (
            <div className="space-y-6">
              <section aria-labelledby="u-account">
                <h3 id="u-account" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Account
                </h3>
                <KeyValue
                  items={[
                    ["Status", <Badge key="s" tone={STATUS_TONE[user.account.status] ?? "neutral"}>{humanize(user.account.status)}</Badge>],
                    ["Email", `${user.account.email}${user.account.emailVerifiedAt ? "" : " (not verified)"}`],
                    ["Mobile", `${user.account.countryCode} ${user.account.mobileNumber}${user.account.mobileVerifiedAt ? "" : " (not verified)"}`],
                    ["Location", [user.account.city, user.account.country].filter(Boolean).join(", ") || "—"],
                    ["Joined", formatDateTime(user.account.createdAt)],
                    ["Last active", user.account.lastActiveAt ? formatDateTime(user.account.lastActiveAt) : "—"],
                    ["User id", <ShortId key="i" id={user.account.id} />],
                  ]}
                />
              </section>

              <section aria-labelledby="u-profile">
                <h3 id="u-profile" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Profile and verification
                </h3>
                {user.profile ? (
                  <div className="space-y-4">
                    <KeyValue
                      items={[
                        ["Verification", <Badge key="v" tone={VERIFICATION_TONE[user.profile.verificationStatus] ?? "neutral"}>{humanize(user.profile.verificationStatus)}</Badge>],
                        ["Profile status", humanize(user.profile.profileStatus)],
                        ["Completion", `${user.profile.profileCompletionPercent}%`],
                        ["Photo", user.profile.hasProfilePhoto ? "Has a photo" : "No photo"],
                        ["Verified at", user.profile.verifiedAt ? formatDate(user.profile.verifiedAt) : "—"],
                      ]}
                    />
                    {can("profiles.verify") ? (
                      <VerifyControls profileId={user.profile.id} current={user.profile.verificationStatus} onChanged={refresh} compact />
                    ) : (
                      <p className="text-[13px] text-rz-muted">Your role cannot change verification (requires profiles.verify).</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-rz-muted">This member has not created a profile yet.</p>
                )}
              </section>

              <section aria-labelledby="u-suspension">
                <h3 id="u-suspension" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Moderation
                </h3>
                <ModerationPanel userId={userId} onDone={refresh} />
              </section>

              <section aria-labelledby="u-warnings">
                <h3 id="u-warnings" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Warnings ({user.warnings.length})
                </h3>
                {user.warnings.length === 0 ? (
                  <p className="text-sm text-rz-muted">No warnings issued.</p>
                ) : (
                  <ul className="space-y-2">
                    {user.warnings.map((w) => (
                      <li key={w.id} className="rounded-md border border-rz-border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={w.status === "ACTIVE" ? "gold" : "neutral"}>{humanize(w.status)}</Badge>
                          <span className="text-[12px] text-rz-muted">{formatDateTime(w.createdAt)}</span>
                          {w.acknowledgedAt && <span className="text-[12px] text-rz-muted">· acknowledged {formatDate(w.acknowledgedAt)}</span>}
                        </div>
                        <p className="mt-1.5 break-words text-rz-text">{w.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {can("warnings.issue") ? (
                  <IssueWarning userId={userId} onDone={refresh} />
                ) : (
                  <p className="mt-3 text-[13px] text-rz-muted">Issuing warnings requires the warnings.issue permission (Super Admin).</p>
                )}
              </section>

              <section aria-labelledby="u-memberships">
                <h3 id="u-memberships" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Memberships ({user.memberships.length})
                </h3>
                {user.memberships.length === 0 ? (
                  <p className="text-sm text-rz-muted">No memberships.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {user.memberships.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-rz-border p-3">
                        <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{humanize(m.status)}</Badge>
                        <span className="text-rz-muted">
                          {m.startedAt ? formatDate(m.startedAt) : "not started"} → {m.expiresAt ? formatDate(m.expiresAt) : "—"}
                        </span>
                        {m.autoRenew && <span className="text-[12px] text-rz-muted">auto-renew on</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="u-reports">
                <h3 id="u-reports" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Reports
                </h3>
                <p className="text-sm text-rz-text">
                  {user.reports.againstCount} filed against this member · {user.reports.filedCount} filed by this member
                </p>
                {user.reports.against.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-[13px]">
                    {user.reports.against.slice(0, 5).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.status === "OPEN" ? "gold" : "neutral"}>{humanize(r.status)}</Badge>
                        <span className="text-rz-muted">{formatDate(r.createdAt)}</span>
                        {r.description && <span className="min-w-0 break-words text-rz-text">{r.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="u-activity">
                <h3 id="u-activity" className="mb-3 font-serif text-base font-semibold text-rz-navy">
                  Recent account activity
                </h3>
                {user.auditHistory.length === 0 ? (
                  <p className="text-sm text-rz-muted">Nothing recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-[13px]">
                    {user.auditHistory.slice(0, 10).map((a) => (
                      <li key={a.id} className="flex flex-wrap gap-x-2 text-rz-text">
                        <span className="font-mono text-[12px]">{a.action}</span>
                        <span className="text-rz-muted">{formatDateTime(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          );
        }}
      </AsyncView>
    </Modal>
  );
}

function IssueWarning({ userId, onDone }: { userId: string; onDone: () => void }) {
  const cats = useAsync((signal) => adminApi.get<{ categories: AdminWarningCategory[] }>("/warning-categories", { signal }), []);
  const [categoryId, setCategoryId] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const issue = useAction((body: { categoryId: string; message: string }) => adminApi.post(`/users/${userId}/warnings`, body));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    const res = await issue.run({ categoryId, message: message.trim() });
    if (res === undefined) return;
    setDone(true);
    setMessage("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-md border border-rz-border bg-rz-cream/50 p-3">
      <p className="text-sm font-semibold text-rz-navy">Issue a warning</p>
      <div>
        <FieldLabel htmlFor={`warn-cat-${userId}`}>Category</FieldLabel>
        <Select id={`warn-cat-${userId}`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required disabled={!cats.data}>
          <option value="">{cats.loading ? "Loading…" : cats.error ? "Could not load categories" : "Choose a category"}</option>
          {cats.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {cats.error && <p className="mt-1 text-[12.5px] text-rz-danger">{cats.error.friendlyMessage}</p>}
      </div>
      <div>
        <FieldLabel htmlFor={`warn-msg-${userId}`}>Message shown to the member</FieldLabel>
        <Textarea id={`warn-msg-${userId}`} rows={3} maxLength={2000} required value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-0" aria-invalid={!!fieldIssue(issue.error, "message")} />
        {fieldIssue(issue.error, "message") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(issue.error, "message")}</p>}
      </div>
      <Button type="submit" size="sm" disabled={issue.pending || !categoryId || !message.trim()}>
        {issue.pending ? "Issuing…" : "Issue warning"}
      </Button>
      <ActionError error={issue.error} />
      {done && <SuccessNote>Warning issued.</SuccessNote>}
    </form>
  );
}
