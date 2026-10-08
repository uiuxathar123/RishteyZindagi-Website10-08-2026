import { cn } from "@/lib/utils";
import { AlertTriangle, Inbox, WifiOff } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "./Button";

/** Generic empty state — "No profiles found", "No messages yet", etc.
 * Every list screen in the product should route through this component
 * instead of rendering ad-hoc blank space. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-rz-border bg-white/60 px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
        {icon ?? <Inbox className="h-6 w-6" strokeWidth={1.6} />}
      </div>
      <p className="font-serif text-lg font-semibold text-rz-navy">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-rz-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Please try again in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-rz-danger/20 bg-rz-danger/5 px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rz-danger/10 text-rz-danger">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.8} />
      </div>
      <p className="font-serif text-lg font-semibold text-rz-navy">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-rz-muted">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function OfflineState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-rz-border bg-white px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rz-border/50 text-rz-muted">
        <WifiOff className="h-6 w-6" strokeWidth={1.8} />
      </div>
      <p className="font-serif text-lg font-semibold text-rz-navy">Check your internet connection</p>
      <p className="mt-1.5 max-w-sm text-sm text-rz-muted">You&apos;re offline — we&apos;ll reconnect automatically.</p>
    </div>
  );
}

/** Skeleton loading block — compose with width/height utility classes. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-rz-border/60", className)} />;
}

export function ProfileCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-rz-border bg-white">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}
