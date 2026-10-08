import { cn } from "@/lib/utils";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { ReactNode } from "react";

/** Inline status message for auth/settings forms. Errors are announced to screen readers. */
export function FormAlert({
  tone,
  children,
  className,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? TriangleAlert : tone === "success" ? CheckCircle2 : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-4 py-3 text-sm font-medium",
        tone === "error" && "border-rz-danger/30 bg-rz-danger/10 text-rz-danger",
        tone === "success" && "border-rz-success/30 bg-rz-success/10 text-rz-success",
        tone === "info" && "border-rz-border bg-rz-peach/40 text-rz-text",
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-medium text-rz-danger">
      {children}
    </p>
  );
}
