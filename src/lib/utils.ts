import { clsx, type ClassValue } from "clsx";

/** Merge conditional class names. Kept tiny on purpose — no tailwind-merge
 * dependency needed while the class lists in this project stay this small. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Formats a number of years into "10th", "1st", "2nd" style ordinal —
 * used for anniversary and milestone copy. */
export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
