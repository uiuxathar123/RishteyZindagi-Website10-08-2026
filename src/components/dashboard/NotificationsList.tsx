"use client";

import { ApiErrorView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { FormAlert } from "@/components/auth/FormAlert";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { ApiError } from "@/lib/api/errors";
import { isApiError } from "@/lib/api/errors";
import type { NotificationView, Page } from "@/lib/api/types";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICATIONS_CHANGED_EVENT } from "./DashboardShell";

const PAGE_SIZE = 20;

function announceChange() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * The member's real notifications (GET /notifications), newest first, with
 * "Load more" pagination, per-item and bulk mark-as-read. Titles and bodies
 * are exactly what the backend stored — nothing is invented client-side.
 */
export function NotificationsList() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const aborter = useRef<AbortController | null>(null);

  const load = useCallback(async (nextPage: number, replace: boolean) => {
    aborter.current?.abort();
    const controller = new AbortController();
    aborter.current = controller;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await api.get<Page<NotificationView>>("/notifications", {
        query: { page: nextPage, pageSize: PAGE_SIZE },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems((prev) => {
        if (replace) return res.items;
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...res.items.filter((n) => !seen.has(n.id))];
      });
      setPage(res.page);
      setTotalPages(res.totalPages);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      if (controller.signal.aborted || (isApiError(e) && e.kind === "aborted")) return;
      if (isApiError(e)) setError(e);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(1, true);
    return () => aborter.current?.abort();
  }, [load]);

  const markOne = useAction(async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)));
    announceChange();
  });

  const markAll = useAction(async () => {
    await api.post("/notifications/read-all");
    setItems((prev) => prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: new Date().toISOString() })));
    announceChange();
  });

  const unreadLoaded = items.filter((n) => !n.isRead).length;

  if (loading && items.length === 0) return <ListSkeleton rows={5} />;
  if (error && items.length === 0) return <ApiErrorView error={error} onRetry={() => void load(1, true)} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="h-6 w-6" strokeWidth={1.6} />}
        title="No notifications yet"
        description="Interests, matches and account updates will show up here."
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-rz-muted">
          {total} notification{total === 1 ? "" : "s"}
          {unreadLoaded > 0 ? ` · ${unreadLoaded} unread shown` : ""}
        </p>
        <Button variant="outline" size="sm" onClick={() => void markAll.run()} disabled={unreadLoaded === 0 || markAll.pending}>
          {markAll.pending ? "Marking…" : "Mark all as read"}
        </Button>
      </div>

      {(markAll.error || markOne.error) && (
        <FormAlert tone="error" className="mb-4">
          {(markAll.error ?? markOne.error)?.friendlyMessage}
        </FormAlert>
      )}

      <ul className="divide-y divide-rz-border overflow-hidden rounded-lg border border-rz-border bg-white">
        {items.map((item) => (
          <li key={item.id} className={cn(!item.isRead && "bg-rz-peach/10")}>
            <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
              <span className="mt-2 flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden="true">
                {!item.isRead && <span className="h-2 w-2 rounded-full bg-rz-maroon" />}
              </span>
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rz-peach text-rz-maroon">
                <Bell className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("break-words text-sm", item.isRead ? "font-medium text-rz-text" : "font-semibold text-rz-navy")}>
                  {item.title}
                  {!item.isRead && <span className="sr-only"> (unread)</span>}
                </p>
                <p className="mt-0.5 whitespace-pre-line break-words text-xs text-rz-muted">{item.body}</p>
                <p className="mt-1 text-[11px] text-rz-muted sm:hidden">{timeAgo(item.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="hidden whitespace-nowrap pt-0.5 text-xs text-rz-muted sm:block">{timeAgo(item.createdAt)}</span>
                {!item.isRead && (
                  <button
                    type="button"
                    onClick={() => void markOne.run(item.id)}
                    disabled={markOne.pending}
                    className="rz-focus text-xs font-semibold text-rz-maroon disabled:opacity-50"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <FormAlert tone="error" className="mt-4">
          {error.friendlyMessage}
        </FormAlert>
      )}

      {page < totalPages && (
        <div className="mt-5 text-center">
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void load(page + 1, false)}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
