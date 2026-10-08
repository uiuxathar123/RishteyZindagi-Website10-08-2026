import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

/** KPI stat tile used on Admin Overview. Kept generic (icon + label +
 * value + optional hint) so future admin metrics reuse it without a new
 * component. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-rz-border bg-white p-5 shadow-card-sm", className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rz-peach text-rz-navy">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
      </div>
      <p className="text-[13px] font-medium text-rz-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl font-bold text-rz-navy">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-rz-muted">{hint}</p>}
    </div>
  );
}
