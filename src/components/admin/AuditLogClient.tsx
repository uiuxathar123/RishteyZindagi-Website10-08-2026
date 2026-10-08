"use client";

import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { PageHeader, Pagination, ShortId, td, th } from "./AdminUi";
import type { AdminAuditEntry, Page } from "./adminTypes";

const PAGE_SIZE = 25;

interface Filters {
  action: string;
  entityType: string;
  actorId: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
}
const EMPTY: Filters = { action: "", entityType: "", actorId: "", entityId: "", dateFrom: "", dateTo: "" };

/** Known action names (as written by the backend) offered as suggestions; any exact action can be typed. */
const ACTION_SUGGESTIONS = [
  "admin.login",
  "profile.verification_changed",
  "report.dismiss",
  "report_category.create",
  "report_category.update",
  "account.suspension_lifted",
  "account.auto_suspended",
  "otp_config.update",
  "matching_weights.update",
  "payment_gateway.activated",
  "payment_gateway.deactivated",
  "payment_gateway.config_updated",
  "payment.manually_activated",
];

/** `/admin/super/audit-log` — read-only, filterable trail of everything admins (and the system) changed. */
export function AuditLogClient() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);

  const list = useAsync(
    (signal) =>
      adminApi.get<Page<AdminAuditEntry>>("/audit-logs", {
        query: {
          action: applied.action.trim() || undefined,
          entityType: applied.entityType.trim() || undefined,
          actorId: applied.actorId.trim() || undefined,
          entityId: applied.entityId.trim() || undefined,
          dateFrom: applied.dateFrom ? `${applied.dateFrom}T00:00:00.000Z` : undefined,
          dateTo: applied.dateTo ? `${applied.dateTo}T23:59:59.999Z` : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
        signal,
      }),
    [applied, page]
  );

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const filtered = Object.values(applied).some(Boolean);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        icon={<ScrollText className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Who did what, and when — every recorded admin and system action, newest first. Times are shown in your local time."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(draft);
        }}
        className="mb-5 rounded-lg border border-rz-border bg-white p-4 shadow-card-sm"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel htmlFor="al-action">Action (exact)</FieldLabel>
            <Input id="al-action" list="al-actions" placeholder="e.g. otp_config.update" value={draft.action} onChange={set("action")} />
            <datalist id="al-actions">
              {ACTION_SUGGESTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div>
            <FieldLabel htmlFor="al-entity-type">Entity type</FieldLabel>
            <Input id="al-entity-type" placeholder="e.g. profile, user, payment" value={draft.entityType} onChange={set("entityType")} />
          </div>
          <div>
            <FieldLabel htmlFor="al-actor">Actor id</FieldLabel>
            <Input id="al-actor" placeholder="UUID of the admin or member" value={draft.actorId} onChange={set("actorId")} />
          </div>
          <div>
            <FieldLabel htmlFor="al-entity">Entity id</FieldLabel>
            <Input id="al-entity" placeholder="UUID of the record changed" value={draft.entityId} onChange={set("entityId")} />
          </div>
          <div>
            <FieldLabel htmlFor="al-from">From (date, UTC)</FieldLabel>
            <Input id="al-from" type="date" value={draft.dateFrom} onChange={set("dateFrom")} />
          </div>
          <div>
            <FieldLabel htmlFor="al-to">To (date, UTC)</FieldLabel>
            <Input id="al-to" type="date" value={draft.dateTo} onChange={set("dateTo")} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          {filtered && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </form>

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={6} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No log entries", description: filtered ? "Nothing matches these filters." : "No actions have been recorded yet." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>When</th>
                    <th className={th}>Actor</th>
                    <th className={th}>Action</th>
                    <th className={th}>Entity</th>
                    <th className={th}>IP</th>
                    <th className={th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id} className="border-b border-rz-border last:border-0">
                      <td className={`${td} whitespace-nowrap text-rz-muted`}>{formatDateTime(e.createdAt)}</td>
                      <td className={td}>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={e.actorType === "ADMIN" ? "navy" : e.actorType === "SYSTEM" ? "gold" : "neutral"}>
                            {e.actorRole ? e.actorRole.replace("_", " ").toLowerCase() : e.actorType.toLowerCase()}
                          </Badge>
                          <ShortId id={e.actorId} />
                        </div>
                      </td>
                      <td className={`${td} font-mono text-[12.5px] text-rz-text`}>{e.action}</td>
                      <td className={td}>
                        <div className="flex flex-col gap-1">
                          <span className="text-rz-text">{e.entityType}</span>
                          <ShortId id={e.entityId} />
                        </div>
                      </td>
                      <td className={`${td} text-rz-muted`}>{e.ipAddress ?? "—"}</td>
                      <td className={td}>
                        {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata as object).length > 0 ? (
                          <details>
                            <summary className="rz-focus cursor-pointer text-[12.5px] font-semibold text-rz-maroon">View</summary>
                            <pre className="mt-2 max-h-48 max-w-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-rz-cream p-2 text-[11.5px] text-rz-text">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-rz-muted">—</span>
                        )}
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
