/*
 * Numbers and dates for the admin's screens. Written by hand rather than with Intl's compact
 * notation or locale dates, which come out differently on the server and in the browser and so
 * would render one thing first and another a moment later.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Dollars: "$0.00" for nothing, four decimals for fractions of a cent, two otherwise. */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** 1,500 as "1.5k", 3,400,000 as "3.4M"; small numbers in full. */
export function count(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const trim = (v: number, suffix: string) => `${(Math.round(v * 10) / 10).toString().replace(/\.0$/, "")}${suffix}`;
  if (abs >= 1e9) return trim(n / 1e9, "B");
  if (abs >= 1e6) return trim(n / 1e6, "M");
  if (abs >= 1e4) return trim(n / 1e3, "k");
  return Math.round(n).toLocaleString("en-US");
}

/** "2026-11-14" as "14 Nov". */
export function dayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

/** A moment as a date: "14 Nov 2026". In the given time zone's own day (UTC until the browser's is known). */
export function dateOf(ts: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: timeZone ?? "UTC" }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return `${get("day")} ${MONTHS[get("month") - 1] ?? ""} ${get("year")}`;
}

/** How long ago, in words: "just now", "12 minutes ago", "yesterday", "3 weeks ago", then the date. */
export function ago(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return dateOf(ts);
}

/** A share of a whole, for the width of a bar: never NaN, never more than 100. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;
}
