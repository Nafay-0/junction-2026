import { RULE_TITLE, clock, clockSeconds, day, helsinkiToday } from "../../_ui/plain";

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

/** Codes the core still writes into sentences (mistake checks, attributes), in words. Rule codes use RULE_TITLE. */
const CODE_WORD: Record<string, string> = {
  quantity_tenfold: "an amount ten times the usual",
  quantity_unusual: "an unusual amount",
  unit_confusion: "a possible unit mix-up",
  unit_unclear: "an unclear unit",
  duplicate_recent: "a possible duplicate",
  delivery_in_past: "a delivery date in the past",
  delivery_not_delivery_day: "a day without deliveries",
  delivery_after_cutoff: "a passed order cut-off",
  contradicts_preference: "a clash with the kitchen's own rules",
  large_first_order: "a large first order",
  nothing_to_repeat: "nothing to repeat",
  lactose_free: "lactose-free",
  fat_free: "fat-free",
  fat_1_5: "1,5 % fat",
  fat_3_5: "3,5 % fat",
  plant_drink: "plant drinks",
  needs_human_approval: "sent to a person",
  auto_approve: "passed",
  pending_approval: "waiting for sign-off",
  best_price: "best price",
  lowest_carbon: "lowest carbon",
  most_reliable: "most reliable",
};

/** The partner's unit codes, in words. */
const UNIT_WORD: Record<string, string> = { ST: "piece", KPL: "piece", KI: "case", PAL: "pallet", KRS: "layer", PS: "bag", RAS: "box", LTR: "L", GRM: "g", KGM: "kg", KG: "kg" };

/** An ISO timestamp anywhere in a sentence, as Helsinki time: "Fri 13.11. 23.24". "+0200" offsets are read too. */
function isoInText(iso: string): string {
  const fixed = iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(fixed);
  if (!Number.isFinite(t)) return iso;
  return `${day(helsinkiToday(new Date(t)))} ${clock(new Date(t))}`;
}

/**
 * A sentence the core wrote, made fit for the surface: "€1,280.50" -> "1 280,50 €", "12.5 %" -> "12,5 %",
 * ISO timestamps -> Helsinki "Fri 13.11. 23.24", "2026-11-16" -> "Mon 16.11.", unit codes ("per ST", "EUR/KI")
 * -> words, and the partner's placeholder stock amounts (999999 and up) -> "an unreported amount".
 */
export function fi(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (code) => CODE_WORD[code] ?? (RULE_TITLE[code] ? `“${RULE_TITLE[code].toLowerCase()}”` : code))
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/g, isoInText)
    .replace(/\b(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\b/g, (_m, d: string, h: string, mi: string) => `${day(d)} ${h}.${mi}`)
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, d: string) => day(d))
    .replace(/\bEUR\s?\/\s?([A-Z]{2,3})\b/g, (_m, u: string) => `€/${UNIT_WORD[u] ?? u.toLowerCase()}`)
    .replace(/\bper ([A-Z]{2,3})\b/g, (_m, u: string) => `per ${UNIT_WORD[u] ?? u.toLowerCase()}`)
    .replace(/\b9{6,}\b(?:\s*(?:packs?|pcs|units?))?/g, "an unreported amount")
    .replace(/€(\d{1,3}(?:,\d{3})*)(?:\.(\d{2}))?/g, (_m, w: string, f?: string) => `${w.replaceAll(",", nbsp)}${f ? `,${f}` : ""}${nbsp}€`)
    .replace(/(\d)\.(\d) ?%/g, "$1,$2 %");
}

/** "Fri 13.11. 23.54" for any timestamp, today or not: for records that must be read later. */
export function stamp(iso: string | undefined): string {
  if (!iso) return "–";
  return `${day(helsinkiToday(new Date(iso)))} ${clock(iso)}`;
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
  onsite: { label: "On-site agent", short: "On-site", how: "The kitchen portal's own agent, inside AimoPilot" },
  mcp: { label: "Outside agent over MCP", short: "MCP", how: "Any company's agent, over the Model Context Protocol" },
  rest: { label: "Outside agent over REST", short: "REST", how: "Any program, over the documented HTTP API" },
};

const COUNTRY: Record<string, string> = { fi: "Finland", se: "Sweden", ee: "Estonia", de: "Germany", dk: "Denmark", nl: "the Netherlands", no: "Norway", pl: "Poland", lt: "Lithuania", lv: "Latvia", fr: "France", it: "Italy", es: "Spain", be: "Belgium", at: "Austria", gb: "the United Kingdom", ie: "Ireland" };

/** "fi" -> "Finland": the partner writes origin as a country code. */
export function country(code: string | null | undefined): string {
  if (!code) return "not stated";
  return COUNTRY[code.toLowerCase()] ?? code.toUpperCase();
}
