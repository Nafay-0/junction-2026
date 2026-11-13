import { clock, clockSeconds, day, helsinkiToday } from "../../_ui/plain";

/**
 * Finnish conventions for the operations portal: money as 1 280,50 €, dates as ti 17.11. (shown with the English
 * weekday the rest of Dock uses), times 14.05 in Helsinki. Sentences the core writes carry €1,280.50; `fi()` turns
 * those into the same format, so one screen never mixes the two.
 */
const nbsp = " ";

export function money(cents: number | undefined | null): string {
  if (cents === undefined || cents === null || !Number.isFinite(cents)) return "–";
  const neg = cents < 0;
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  return `${neg ? "−" : ""}${grouped},${frac}${nbsp}€`;
}

export function moneyShort(cents: number | undefined | null): string {
  if (cents === undefined || cents === null) return "–";
  return cents % 100 === 0 ? `${(cents / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)}${nbsp}€` : money(cents);
}

/** "€1,280.50" and "€500" inside a sentence -> "1 280,50 €", "500 €". Also "12.5 %" -> "12,5 %". */
export function fi(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/€(\d{1,3}(?:,\d{3})*)(?:\.(\d{2}))?/g, (_m, w: string, f?: string) => `${w.replaceAll(",", nbsp)}${f ? `,${f}` : ""}${nbsp}€`)
    .replace(/(\d)\.(\d) ?%/g, "$1,$2 %");
}

export function num(n: number | undefined | null): string {
  if (n === undefined || n === null) return "–";
  return n.toLocaleString("en-US").replaceAll(",", nbsp);
}

export function pct(share: number | null | undefined, digits = 1): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "–";
  return `${(share * 100).toFixed(digits).replace(".", ",")}${nbsp}%`;
}

/** "14.05" today, "Tue 17.11. 14.05" another day. */
export function when(iso: string | undefined, now = new Date()): string {
  if (!iso) return "–";
  const d = helsinkiToday(new Date(iso));
  return d === helsinkiToday(now) ? clock(iso) : `${day(d)} ${clock(iso)}`;
}

export function whenSeconds(iso: string | undefined): string {
  return iso ? clockSeconds(iso) : "–";
}

/** "3 min", "1 h 20 min": how long something has waited. */
export function duration(fromIso: string, nowMs: number): string {
  return span(nowMs - Date.parse(fromIso));
}

export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** "in 12 min", "expired 3 min ago" */
export function until(iso: string, nowMs: number): { text: string; expired: boolean } {
  const ms = Date.parse(iso) - nowMs;
  if (ms <= 0) return { text: `expired ${span(-ms)} ago`, expired: true };
  return { text: `in ${span(ms)}`, expired: false };
}

export function since(iso: string | undefined, nowMs: number): string {
  if (!iso) return "–";
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  return `${duration(iso, nowMs)} ago`;
}

export type Via = "onsite" | "mcp" | "rest";
export const VIA: Record<Via, { label: string; short: string; how: string }> = {
  onsite: { label: "On-site agent", short: "On-site", how: "The kitchen portal's own agent, inside Dock" },
  mcp: { label: "Outside agent over MCP", short: "MCP", how: "Any company's agent, over the Model Context Protocol" },
  rest: { label: "Outside agent over REST", short: "REST", how: "Any program, over the documented HTTP API" },
};
