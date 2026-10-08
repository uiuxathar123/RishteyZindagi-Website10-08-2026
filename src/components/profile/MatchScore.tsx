import { cn } from "@/lib/utils";
import type { CompatibilityBreakdownRow } from "@/lib/api/types";

/** Circular compatibility indicator — "92% Match". Radius/stroke are fixed
 * so the ring always reads crisply at the sizes used across the product. */
export function MatchScore({ value, size = 44 }: { value: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#F4E5C4" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#A51E3B"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={cn("absolute font-sans font-bold text-rz-navy", size <= 44 ? "text-[10px]" : "text-sm")}>
        {value}%
      </span>
    </div>
  );
}

/** Labels for the backend's ten scoring categories (recommendations/scoring.ts). */
const CATEGORY_LABELS: Record<string, string> = {
  age: "Age",
  height: "Height",
  religion: "Religion",
  community: "Community",
  motherTongue: "Mother tongue",
  education: "Education",
  profession: "Profession",
  maritalStatus: "Marital status",
  location: "Location",
  income: "Income",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const RESULT_LABELS: Record<string, { text: string; className: string }> = {
  full: { text: "Matches", className: "text-rz-success" },
  partial: { text: "Partly", className: "text-rz-warning" },
  none: { text: "Differs", className: "text-rz-danger" },
};

/**
 * The real per-category result from GET /profiles/me/recommendations.
 * Categories the backend could not evaluate ("unavailable") are left out
 * rather than shown as zero.
 */
export function BreakdownRows({ rows }: { rows: CompatibilityBreakdownRow[] }) {
  const evaluated = rows.filter((r) => r.result !== "unavailable");
  if (evaluated.length === 0) return null;
  return (
    <ul className="space-y-2">
      {evaluated.map((r) => {
        const label = RESULT_LABELS[r.result] ?? { text: r.result, className: "text-rz-muted" };
        const pct = r.weight > 0 ? Math.round((r.contribution / r.weight) * 100) : 0;
        return (
          <li key={r.category}>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-rz-navy">
              <span>{categoryLabel(r.category)}</span>
              <span className={label.className}>{label.text}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-rz-border/60" aria-hidden="true">
              <div className="h-full rounded-full bg-rz-maroon" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CompatibilityBreakdown({ scores }: { scores: Record<string, number> }) {
  return (
    <ul className="space-y-3">
      {Object.entries(scores).map(([key, value]) => (
        <li key={key}>
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-rz-navy">
            <span>{categoryLabel(key)}</span>
            <span className="text-rz-muted">{value}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-rz-border/60">
            <div className="h-full rounded-full bg-rz-maroon" style={{ width: `${value}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
