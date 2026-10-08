/** Small display helpers shared by member and admin screens. */

/** Backend money is an integer in the currency's smallest unit (paise/cents). */
export function formatMoney(smallestUnit: number, currency: string): string {
  const value = smallestUnit / 100;
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  const hasFraction = smallestUnit % 100 !== 0;
  return `${symbol}${value.toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "just now", "5 minutes ago", "2 days ago", then a plain date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export function formatHeight(cm: number | null | undefined): string {
  if (!cm) return "";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return inches === 12 ? `${feet + 1}′ 0″ (${cm} cm)` : `${feet}′ ${inches}″ (${cm} cm)`;
}

export function genderLabel(g: string | null | undefined): string {
  return g === "FEMALE" ? "Bride" : g === "MALE" ? "Groom" : "";
}

/** Human title-case for enum-ish backend strings: "READY_FOR_VISIBILITY" → "Ready for visibility". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "9876543210" -> "+91 98765 43210"-style masking is NOT done here; callers show what the API returns. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
