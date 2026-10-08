"use client";

/**
 * `/admin/account-deletions` — read-only view of members who asked to delete their account.
 * PENDING accounts can still be recovered by the member until the date shown; FINALIZED accounts
 * have been anonymised by the scheduled job and cannot be restored. Nothing here changes data.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { FieldLabel, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { AccountDeletionsPage } from "@/lib/api/pcp-types";
import { formatDateTime } from "@/lib/format";
import { UserX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, Pagination, td, th } from "./AdminUi";

const PAGE_SIZE = 20;

export function AccountDeletionsClient() {
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [state]);

  const list = useAsync(
    (signal) => adminApi.get<AccountDeletionsPage>("/account-deletions", { query: { state: state || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [state, page]
  );

  return (
    <div>
      <PageHeader
        title="Account deletions"
        icon={<UserX className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
        description={
          list.data
            ? `Members can recover a pending deletion for ${list.data.recoveryWindowDays} days; after that the account is anonymised permanently.`
            : "Members who asked to delete their account."
        }
      />
      <div className="mb-5 max-w-xs">
        <FieldLabel htmlFor="del-state">State</FieldLabel>
        <Select id="del-state" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All</option>
          <option value="PENDING">Pending (recoverable)</option>
          <option value="FINALIZED">Finalised (anonymised)</option>
        </Select>
      </div>
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No deletion requests", description: "Nobody has asked to delete their account." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Member</th>
                    <th className={th}>State</th>
                    <th className={th}>Requested</th>
                    <th className={th}>Recoverable until</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.userId} className="border-b border-rz-border last:border-0">
                      <td className={td}>
                        {r.state === "PENDING" ? (
                          <Link href={`/admin/users?user=${r.userId}`} className="rz-focus font-medium text-rz-maroon hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-rz-text">{r.name}</span>
                        )}
                        <div className="text-[12.5px] text-rz-muted">{r.email ?? "Email removed"}</div>
                      </td>
                      <td className={td}>
                        <Badge tone={r.state === "PENDING" ? "gold" : "neutral"}>{r.state === "PENDING" ? "Pending" : "Finalised"}</Badge>
                      </td>
                      <td className={`${td} text-rz-muted`}>{r.requestedAt ? formatDateTime(r.requestedAt) : "—"}</td>
                      <td className={`${td} text-rz-muted`}>
                        {r.state === "PENDING" && r.recoverUntil ? `${formatDateTime(r.recoverUntil)} (${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left)` : "—"}
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
    </div>
  );
}
