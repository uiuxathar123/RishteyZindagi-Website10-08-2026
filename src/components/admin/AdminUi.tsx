"use client";

/** Small building blocks shared by every Admin Panel screen. */
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";

export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-bold text-rz-navy md:text-3xl">
          {icon}
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-rz-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  className,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-rz-border bg-white shadow-card-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rz-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="font-serif text-lg font-semibold text-rz-navy">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-rz-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Table header cell / body cell class helpers (keeps the existing admin table look). */
export const th = "p-4 font-semibold text-rz-navy whitespace-nowrap";
export const td = "p-4 align-top";

/** Inline error for a failed action, announced to assistive tech. */
export function ActionError({ error, className }: { error: ApiError | null; className?: string }) {
  return (
    <div aria-live="polite" className={className}>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-[13px] text-rz-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {error.kind === "forbidden"
              ? `Not allowed: ${error.message || "your role does not have permission for this action."}`
              : error.friendlyMessage}
          </span>
        </p>
      )}
    </div>
  );
}

/** Message under a form field, from ApiError.details (`path` is the body key). */
export function fieldIssue(error: ApiError | null, path: string): string | undefined {
  return error?.details.find((d) => d.path === path)?.message;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-rz-success/30 bg-rz-success/10 px-3 py-2 text-[13px] font-medium text-rz-success">
      {children}
    </p>
  );
}

/** Honest "this has no backend" notice. */
export function NotAvailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-rz-border bg-rz-cream px-4 py-4 text-sm text-rz-text">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-rz-muted" />
      <div>
        <p className="font-semibold text-rz-navy">{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-rz-muted">{children}</div>
      </div>
    </div>
  );
}

/** Full-page 403 for screens the signed-in admin's role cannot use. */
export function ForbiddenScreen({ title = "Not allowed", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-rz-danger/20 bg-rz-danger/5 px-6 py-16 text-center" role="alert">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rz-danger/10 text-rz-danger">
        <ShieldAlert className="h-6 w-6" strokeWidth={1.8} />
      </div>
      <p className="font-serif text-xl font-semibold text-rz-navy">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-rz-muted">{children}</p>
      <Link href="/admin" className="rz-focus mt-6 text-sm font-semibold text-rz-maroon underline-offset-2 hover:underline">
        Back to Overview
      </Link>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  disabled,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-rz-border px-4 py-3 text-[13px] text-rz-muted">
      <span>
        {from}–{to} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
          Prev
        </Button>
        <span aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)} icon={<ChevronRight className="h-4 w-4" />} iconPosition="right">
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Debounced copy of a value (search boxes). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Accessible dialog. `variant="drawer"` slides in from the right on wide
 * screens and fills the viewport on phones.
 */
export function Modal({
  title,
  onClose,
  children,
  variant = "dialog",
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "dialog" | "drawer";
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-modal flex" role="presentation">
      <div className="absolute inset-0 bg-rz-navy-dark/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-full flex-col bg-white shadow-popover outline-none",
          variant === "drawer"
            ? "ml-auto h-full w-full sm:max-w-xl"
            : "m-auto w-[calc(100%-2rem)] max-w-md rounded-lg"
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-rz-border px-5 py-4">
          <h2 className="min-w-0 truncate font-serif text-lg font-semibold text-rz-navy">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rz-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-rz-muted hover:bg-rz-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rz-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Short, copy-friendly id for tables ("8d1d1da8…"). */
export function ShortId({ id, href }: { id: string | null | undefined; href?: string }) {
  if (!id) return <span className="text-rz-muted">—</span>;
  const label = `${id.slice(0, 8)}…`;
  return href ? (
    <Link href={href} title={id} className="rz-focus font-mono text-[12.5px] text-rz-maroon underline-offset-2 hover:underline">
      {label}
    </Link>
  ) : (
    <span title={id} className="font-mono text-[12.5px] text-rz-muted">
      {label}
    </span>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] font-semibold uppercase tracking-wide text-rz-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-rz-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
