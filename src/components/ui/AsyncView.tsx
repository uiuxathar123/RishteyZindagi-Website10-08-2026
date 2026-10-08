"use client";

import { ReactNode } from "react";
import type { ApiError } from "@/lib/api/errors";
import { EmptyState, ErrorState, OfflineState, Skeleton } from "./States";

/** Standard error presentation for every ApiError kind. */
export function ApiErrorView({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  switch (error.kind) {
    case "network":
      return <OfflineState />;
    case "forbidden":
      return <ErrorState title="Not allowed" description={error.message || "You don't have permission to see this."} />;
    case "not_found":
      return <ErrorState title="Not found" description={error.message || "We couldn't find what you were looking for."} />;
    case "unauthorized":
      return <ErrorState title="Session ended" description="Please log in again to continue." />;
    case "rate_limited":
      return <ErrorState title="Slow down a little" description={error.friendlyMessage} onRetry={onRetry} />;
    case "unavailable":
      return <ErrorState title="Temporarily unavailable" description={error.friendlyMessage} onRetry={onRetry} />;
    default:
      return <ErrorState description={error.friendlyMessage} onRetry={onRetry} />;
  }
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * loading → skeleton, error (with nothing to show) → error view with retry,
 * empty → EmptyState, otherwise the render prop. Stale data stays visible
 * while a reload is in flight.
 */
export function AsyncView<T>({
  data,
  error,
  loading,
  reload,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; description?: string; action?: ReactNode };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (data === null && loading) return <>{skeleton ?? <ListSkeleton />}</>;
  if (data === null && error) return <ApiErrorView error={error} onRetry={reload} />;
  if (data === null) return null;
  if (isEmpty?.(data)) return <EmptyState title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} />;
  return <>{children(data)}</>;
}
