"use client";

/**
 * Dependency-free SVG bar chart for the Overview trends (B19). Each chart also carries a visually-hidden data table so
 * the numbers are available to screen readers and to tests. Values are daily totals (Asia/Kolkata days).
 */
import { useId } from "react";

export interface TrendPoint {
  date: string;
  value: number;
}

export function TrendChart({ title, points, format = (n: number) => n.toLocaleString("en-IN"), color = "#7a1f3d" }: { title: string; points: TrendPoint[]; format?: (n: number) => string; color?: string }) {
  const id = useId();
  const w = 560;
  const h = 140;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + p.value, 0);
  const bw = (w - pad.l - pad.r) / Math.max(1, points.length);
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;
  return (
    <figure className="rounded-lg border border-rz-border bg-white p-4 shadow-card-sm" data-testid={`trend-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-serif text-base font-semibold text-rz-navy">{title}</span>
        <span className="text-xs text-rz-muted">Total {format(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-labelledby={id} className="h-36 w-full">
        <title id={id}>{`${title}, daily, ${first ?? ""} to ${last ?? ""}. Total ${format(total)}.`}</title>
        <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} stroke="#d9d2c5" />
        {points.map((p, i) => {
          const bh = ((h - pad.t - pad.b) * p.value) / max;
          return (
            <rect key={p.date} x={pad.l + i * bw + 1} y={h - pad.b - bh} width={Math.max(1, bw - 2)} height={p.value === 0 ? 0 : Math.max(1.5, bh)} fill={color} rx={1.5}>
              <title>{`${p.date}: ${format(p.value)}`}</title>
            </rect>
          );
        })}
        <text x={pad.l} y={h - 6} fontSize="10" fill="#6b6b6b">{first}</text>
        <text x={w - pad.r} y={h - 6} fontSize="10" fill="#6b6b6b" textAnchor="end">{last}</text>
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Date</th><th>Value</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.date}><td>{p.date}</td><td>{p.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
