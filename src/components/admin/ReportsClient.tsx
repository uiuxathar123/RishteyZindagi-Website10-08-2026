"use client";

import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { formatDateTime, humanize } from "@/lib/format";
import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, fieldIssue, PageHeader, Pagination, ShortId, SuccessNote, td, th } from "./AdminUi";
import type { AdminReportCategory, AdminReportRow, Page } from "./adminTypes";

const STATUS_TONE: Record<string, "gold" | "success" | "neutral" | "navy"> = {
  OPEN: "gold",
  IN_REVIEW: "navy",
  RESOLVED: "success",
  DISMISSED: "neutral",
};

const PAGE_SIZE = 20;

/** `/admin/reports` — review member reports, plus report-category management where permitted. */
export function ReportsClient() {
  const { can } = useAdminSession();
  const canCategories = can("reports.categories.manage");

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Reports filed by members against other members."
        icon={<Flag className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
      />
      {canCategories ? (
        <Tabs
          items={[
            { id: "reports", label: "Reports" },
            { id: "categories", label: "Report categories" },
          ]}
        >
          {(tab) => <div className="pt-5">{tab === "reports" ? <ReportsList /> : <CategoriesPanel />}</div>}
        </Tabs>
      ) : (
        <ReportsList />
      )}
    </div>
  );
}

function useCategoryNames(enabled: boolean) {
  const cats = useAsync(
    async (signal) => (enabled ? (await adminApi.get<{ categories: AdminReportCategory[] }>("/report-categories", { signal })).categories : []),
    [enabled]
  );
  const names = new Map<string, string>();
  cats.data?.forEach((c) => names.set(c.id, c.name));
  return names;
}

function ReportsList() {
  const { can } = useAdminSession();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const names = useCategoryNames(can("reports.categories.manage"));
  useEffect(() => setPage(1), [status]);

  const list = useAsync(
    (signal) => adminApi.get<Page<AdminReportRow>>("/reports", { query: { status: status || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [status, page]
  );

  return (
    <div>
      <div className="mb-5 max-w-xs">
        <FieldLabel htmlFor="report-status">Status</FieldLabel>
        <Select id="report-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All reports</option>
          <option value="OPEN">Open</option>
          <option value="IN_REVIEW">In review</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </Select>
      </div>

      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No reports", description: status ? "No reports with this status." : "No member has filed a report yet." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Reported member</th>
                    <th className={th}>Reported by</th>
                    <th className={th}>Category</th>
                    <th className={th}>Details</th>
                    <th className={th}>Filed</th>
                    <th className={th}>Status</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <ReportRow key={r.id} report={r} categoryName={names.get(r.categoryId)} onChanged={list.reload} />
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

function ReportRow({ report, categoryName, onChanged }: { report: AdminReportRow; categoryName?: string; onChanged: () => void }) {
  const dismiss = useAction(() => adminApi.patch<{ report: AdminReportRow }>(`/reports/${report.id}`, { status: "DISMISSED" }));
  const [confirming, setConfirming] = useState(false);

  async function onDismiss() {
    const res = await dismiss.run();
    if (!res) return;
    setConfirming(false);
    onChanged();
  }

  const closed = report.status === "DISMISSED" || report.status === "RESOLVED";

  return (
    <tr className="border-b border-rz-border last:border-0">
      <td className={td}>
        <ShortId id={report.reportedUserId} href={`/admin/users?user=${report.reportedUserId}`} />
      </td>
      <td className={td}>
        <ShortId id={report.reporterUserId} href={`/admin/users?user=${report.reporterUserId}`} />
      </td>
      <td className={td}>{categoryName ?? <ShortId id={report.categoryId} />}</td>
      <td className={`${td} max-w-[280px] break-words text-rz-muted`}>{report.description || "—"}</td>
      <td className={`${td} whitespace-nowrap text-rz-muted`}>{formatDateTime(report.createdAt)}</td>
      <td className={td}>
        <Badge tone={STATUS_TONE[report.status] ?? "neutral"}>{humanize(report.status)}</Badge>
      </td>
      <td className={td}>
        {closed ? (
          <span className="text-[12.5px] text-rz-muted">{report.resolvedAt ? formatDateTime(report.resolvedAt) : "Closed"}</span>
        ) : confirming ? (
          <div className="flex flex-col items-start gap-2">
            <span className="text-[12.5px] text-rz-muted">Dismiss without action?</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={dismiss.pending} onClick={onDismiss}>
                {dismiss.pending ? "Dismissing…" : "Yes, dismiss"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setConfirming(false); dismiss.clearError(); }}>
                Cancel
              </Button>
            </div>
            <ActionError error={dismiss.error} />
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Dismiss
          </Button>
        )}
      </td>
    </tr>
  );
}

function CategoriesPanel() {
  const cats = useAsync((signal) => adminApi.get<{ categories: AdminReportCategory[] }>("/report-categories", { signal }), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction((body: { name: string; description?: string }) =>
    adminApi.post<{ category: AdminReportCategory }>("/report-categories", body)
  );

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreated(null);
    const res = await create.run({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
    if (!res) return;
    setCreated(`Added “${res.category.name}”.`);
    setName("");
    setDescription("");
    cats.reload();
  }

  return (
    <div className="space-y-6">
      <Card title="Add a category" description="Members pick one of the active categories when they report someone.">
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div>
            <FieldLabel htmlFor="cat-name">Name</FieldLabel>
            <Input id="cat-name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldIssue(create.error, "name")} />
            {fieldIssue(create.error, "name") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "name")}</p>}
          </div>
          <div>
            <FieldLabel htmlFor="cat-desc">Description (optional)</FieldLabel>
            <Input id="cat-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="md:pt-[26px]">
            <Button type="submit" disabled={create.pending || !name.trim()}>
              {create.pending ? "Adding…" : "Add category"}
            </Button>
          </div>
          <div className="md:col-span-3 space-y-2">
            <ActionError error={create.error} />
            {created && <SuccessNote>{created}</SuccessNote>}
          </div>
        </form>
      </Card>

      <AsyncView
        data={cats.data}
        error={cats.error}
        loading={cats.loading}
        reload={cats.reload}
        skeleton={<ListSkeleton rows={4} />}
        isEmpty={(d) => d.categories.length === 0}
        empty={{ title: "No report categories", description: "Add the first category above." }}
      >
        {(d) => (
          <Card title={`Categories (${d.categories.length})`} description="Categories are never deleted, only deactivated, so past reports keep their meaning.">
            <ul className="divide-y divide-rz-border">
              {d.categories.map((c) => (
                <CategoryRow key={c.id} category={c} onChanged={cats.reload} />
              ))}
            </ul>
          </Card>
        )}
      </AsyncView>
    </div>
  );
}

function CategoryRow({ category, onChanged }: { category: AdminReportCategory; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const update = useAction((body: { name?: string; description?: string | null; isActive?: boolean }) =>
    adminApi.patch<{ category: AdminReportCategory }>(`/report-categories/${category.id}`, body)
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await update.run({ name: name.trim(), description: description.trim() ? description.trim() : null });
    if (!res) return;
    setEditing(false);
    onChanged();
  }

  async function toggle(next: boolean) {
    const res = await update.run({ isActive: next });
    if (res) onChanged();
  }

  return (
    <li className="px-5 py-4">
      {editing ? (
        <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <FieldLabel htmlFor={`cn-${category.id}`}>Name</FieldLabel>
            <Input id={`cn-${category.id}`} maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldIssue(update.error, "name")} />
            {fieldIssue(update.error, "name") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(update.error, "name")}</p>}
          </div>
          <div>
            <FieldLabel htmlFor={`cd-${category.id}`}>Description</FieldLabel>
            <Textarea id={`cd-${category.id}`} rows={1} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-0 h-12" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={update.pending || !name.trim()}>
              {update.pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setName(category.name); setDescription(category.description ?? ""); update.clearError(); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-rz-text">
              {category.name}
              <Badge tone={category.isActive ? "success" : "neutral"}>{category.isActive ? "Active" : "Inactive"}</Badge>
            </p>
            {category.description && <p className="mt-0.5 break-words text-[13px] text-rz-muted">{category.description}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Toggle label={category.isActive ? "Active" : "Inactive"} checked={category.isActive} disabled={update.pending} onChange={toggle} />
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      )}
      <ActionError error={update.error} className="mt-2" />
    </li>
  );
}
