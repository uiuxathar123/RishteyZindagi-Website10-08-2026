"use client";

/**
 * `/admin/super/security-events` — read-only feed of sign-in attempts and security-relevant changes (B18, `audit.view`).
 * Login identifiers arrive masked from the server. Nothing here can change data.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { SecurityEventRow } from "@/lib/api/b18-types";
import type { Page } from "@/lib/api/types";
import { formatDateTime, humanize } from "@/lib/format";
import { Download, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader, Pagination, ShortId, td, th, useDebounced } from "./AdminUi";

const PAGE_SIZE = 25;

function tone(kind: string): "success" | "maroon" | "navy" | "neutral" {
  if (kind === "LOGIN_SUCCEEDED") return "success";
  if (kind === "LOGIN_FAILED") return "maroon";
  return "navy";
}

export function SecurityEventsClient() {
  const [type, setType] = useState("ALL");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [type, actor, q, from, to]);
  const badRange = !!from && !!to && from > to;

  const list = useAsync(
    (signal) =>
      badRange
        ? Promise.resolve(null)
        : adminApi.get<Page<SecurityEventRow>>("/security-events", {
            query: {
              type: type !== "ALL" ? type : undefined,
              actor: actor || undefined,
              q: q || undefined,
              dateFrom: from ? `${from}T00:00:00.000Z` : undefined,
              dateTo: to ? `${to}T23:59:59.999Z` : undefined,
              page,
              pageSize: PAGE_SIZE,
            },
            signal,
          }),
    [type, actor, q, from, to, page, badRange]
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const url = adminApi.url("/security-events/export", {
        type: type !== "ALL" ? type : undefined,
        actor: actor || undefined,
        q: q || undefined,
        dateFrom: from ? `${from}T00:00:00.000Z` : undefined,
        dateTo: to ? `${to}T23:59:59.999Z` : undefined,
      });
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `security-events-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      setExportError("The export could not be created. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Security Events"
        icon={<ShieldAlert className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Sign-in attempts and security-relevant changes, newest first. Login names are partly hidden. Times are shown in your local time."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={exportCsv} disabled={exporting || badRange} icon={<Download className="h-4 w-4" />}>
            {exporting ? "Preparing…" : "Export CSV"}
          </Button>
        }
      />
      {exportError && <p role="alert" className="mb-3 text-sm text-rz-danger">{exportError}</p>}
      <div className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-rz-border bg-white p-4 shadow-card-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <FieldLabel htmlFor="se-type">Show</FieldLabel>
          <Select id="se-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">Everything</option>
            <option value="LOGIN_FAILED">Failed sign-ins</option>
            <option value="LOGIN_SUCCEEDED">Successful sign-ins</option>
            <option value="CHANGES">Security changes</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="se-actor">Who</FieldLabel>
          <Select id="se-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Members and admins</option>
            <option value="USER">Members</option>
            <option value="ADMIN">Admins</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="se-q">Search</FieldLabel>
          <Input id="se-q" placeholder="Address, IP or event…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="se-from">From (UTC)</FieldLabel>
          <Input id="se-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="se-to">To (UTC)</FieldLabel>
          <Input id="se-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {badRange && <p role="alert" className="text-sm text-rz-danger sm:col-span-2 lg:col-span-5">The start date is after the end date.</p>}
      </div>

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={6} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No events", description: "Nothing matches these filters." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="security-events-table">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>When</th>
                    <th className={th}>Event</th>
                    <th className={th}>Who</th>
                    <th className={th}>Subject</th>
                    <th className={th}>IP</th>
                    <th className={th}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={`${e.source}-${e.id}`} className="border-b border-rz-border last:border-0">
                      <td className={`${td} whitespace-nowrap text-rz-muted`}>{formatDateTime(e.occurredAt)}</td>
                      <td className={td}>
                        <Badge tone={tone(e.kind)}>{e.source === "LOGIN_ATTEMPT" ? humanize(e.kind) : e.kind}</Badge>
                      </td>
                      <td className={`${td} text-rz-muted`}>{humanize(e.actorType)}</td>
                      <td className={td}>{e.source === "LOGIN_ATTEMPT" ? <span className="font-mono text-[12.5px]">{e.subject ?? "—"}</span> : <ShortId id={e.subject} />}</td>
                      <td className={`${td} text-rz-muted`}>{e.ipAddress ?? "—"}</td>
                      <td className={`${td} text-[12.5px] text-rz-muted`}>{e.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>
      <p className="mt-4 text-[13px] text-rz-muted">
        For the full record of any change, open the <a className="font-semibold text-rz-maroon underline underline-offset-2" href="/admin/super/audit-log">Audit Log</a>.
      </p>
    </div>
  );
}
