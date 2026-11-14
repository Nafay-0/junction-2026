import { groupL } from "../../k/[kitchen]/groups";
import { RULE_TITLE, ROLE_LABEL, clock, clockSeconds, dayEn as day, helsinkiToday } from "../../_ui/plain";

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
  readings_differ: "two readings that differ",
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
  // What the watch and the live check write about stock and cut-offs.
  stock_unknown: "stock not reported",
  cutoff_passed: "order cut-off passed",
  out_of_stock: "out of stock",
  not_delivered: "no delivery that day",
  set_auto_renew: "automatic renewal",
  // Ledger entry kinds, for "Ledger entry 144 (approval_requested)".
  approval_requested: "sign-off asked",
  approval_granted: "signed off",
  approval_declined: "declined",
  order_committed: "order placed",
  sign_off: "a sign-off",
  watch_said: "the watch spoke",
  // Kinds of card the conversation showed.
  product_specification: "product specification",
  standing_order: "standing order",
  delivery_days: "delivery days",
};

/** Ids the core writes into sentences, as plain nouns (the id itself stays in the record's details). */
function idsOut(text: string): string {
  return text
    .replace(/ \((?:order )?ord_[a-z0-9]+\)/gi, "")
    .replace(/\bagent:agent_[a-z0-9_]+/gi, "the agent")
    .replace(/\b(?:agent|Agent) agent_[a-z0-9_]+/g, (m) => (m.startsWith("A") ? "The agent" : "the agent"))
    .replace(/\bagent_[a-z0-9_]+/gi, "the agent")
    .replace(/\b(?:order )?ord_[a-z0-9]+/gi, "the order")
    .replace(/\b(?:quote )?qt_[a-z0-9]+/gi, "the quote")
    .replace(/\breq_[a-z0-9]+/gi, "the request")
    .replace(/\bapr_[a-z0-9]+/gi, "the sign-off")
    .replace(/\bwf_[a-z0-9]+/gi, "")
    .replace(/\bopt_(\d+)/g, "option $1")
    .replace(/\bDock\b/g, "AimoPilot");
}

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
  return idsOut(text)
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (code) => CODE_WORD[code] ?? (RULE_TITLE[code] ? `“${RULE_TITLE[code].toLowerCase()}”` : ROLE_LABEL[code] ?? code))
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/g, isoInText)
    .replace(/\b(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\b/g, (_m, d: string, h: string, mi: string) => `${day(d)} ${h}.${mi}`)
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, d: string) => day(d))
    // The core's own "Mon 16.11." in a sentence, said the way this surface says a day.
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})\.(\d{1,2})\.(?!\d)/g, (_m, w: string, d: string, mo: string) => `${w} ${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1] ?? mo}`)
    .replace(/\bEUR\s?\/\s?([A-Z]{2,3})\b/g, (_m, u: string) => `€/${UNIT_WORD[u] ?? u.toLowerCase()}`)
    .replace(/\bper ([A-Z]{2,3})\b/g, (_m, u: string) => `per ${UNIT_WORD[u] ?? u.toLowerCase()}`)
    .replace(/\b9{6,}\b(?:\s*(?:packs?|pcs|units?))?/g, "an unreported amount")
    .replace(/€(\d{1,3}(?:,\d{3})*)(?:\.(\d{2}))?/g, (_m, w: string, f?: string) => `${w.replaceAll(",", nbsp)}${f ? `,${f}` : ""}${nbsp}€`)
    .replace(/(\d)\.(\d) ?%/g, "$1,$2 %")
    // "17,536 products", "1,000 L": thousands with a no-break space, as the surface writes every other figure.
    .replace(/\b\d{1,3}(?:,\d{3})+(?![.,]?\d)/g, (n) => n.replaceAll(",", nbsp))
    // "0.49 € less", "3.75 l", "16.2 kg": a decimal comma before a unit, as everywhere else on the surface.
    .replace(/\b(\d+)\.(\d+)(\s?)(€|kg|g|l|L|dl|ml|t)(?![\w.])/g, (_m, a: string, b: string, sp: string, u: string) => `${a},${b}${sp || nbsp}${u}`);
}

/** "Fri 13 Nov 23.54" for any timestamp, today or not: for records that must be read later. */
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

/** "14.05" today, "Tue 17 Nov 14.05" another day. */
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

// ---------- an order's state, in the same words and colours everywhere ----------

export type OrderStatus = "pending_approval" | "committed" | "rejected" | "declined" | "withdrawn" | "expired" | "replaced";

/** The order's state in two or three words: the badge. The store says the same in the buyer's words. */
export const STATUS_WORD: Record<OrderStatus, string> = {
  pending_approval: "Waiting for sign-off",
  committed: "Placed",
  rejected: "Refused",
  declined: "Declined",
  withdrawn: "Taken back",
  expired: "Expired unsigned",
  replaced: "Replaced",
};

/** The badge's tone: the gate's colours only for a sign-off waiting and a refusal; placed is green; the rest quiet. */
export function statusTone(status: string): "waiting" | "good" | "refused" | "neutral" {
  return status === "pending_approval" ? "waiting" : status === "committed" ? "good" : status === "rejected" ? "refused" : "neutral";
}

/** How the order was decided, in words: who let it through, and the rule that decided it (never its code). */
export function decidedWords(d: { kind: string; words: string; rule?: string; person?: string }): { head: string; rule?: string } {
  const rule = d.rule ? (RULE_TITLE[d.rule] ?? fi(d.rule)) : undefined;
  if (d.kind === "alone") return { head: "Agent alone, within its limit" };
  if (d.kind === "person") return { head: d.person ? `Sent to ${d.person}` : "Sent to a person", rule };
  if (d.kind === "refused") return { head: "Refused by the gate", rule };
  return { head: fi(d.words) };
}

/**
 * "Only butter, cat 10418, cat 10431, …, milk." (a mandate's allowed categories as the core writes them) as product
 * groups in words: "Only dairy and cheese, frozen food and 4 more groups; butter, milk, cream." Never a code.
 */
export function categoriesInWords(text: string): string {
  // "Only a, b, c." (Agents) or "Product groups: a, b, c" (Time machine).
  const m = /^(Only |[^:,]{1,40}: )(.+?)\.?$/.exec(text.trim());
  if (!m || !/\bcat[ _]\d{3,}/.test(text)) return text;
  const items = m[2].split(/,\s*/);
  const groups = new Map<string, number>();
  const named: string[] = [];
  for (const it of items) {
    const code = /^cat[ _](\d{3,})$/.exec(it.trim())?.[1];
    if (code) {
      const g = groupL(`cat_${code}`, "en");
      if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
    } else named.push(it.trim().replaceAll("_", " "));
  }
  const g = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  const shown = g.slice(0, 4).join(", ") + (g.length > 4 ? ` and ${g.length - 4} more groups` : "");
  return `${m[1]}${[shown, named.join(", ")].filter(Boolean).join("; ")}.`;
}

const ENV_NAME = /\b(?:DOCK|KAFKA|AIVEN|OPENSEARCH|VALKEY|DATABASE|RADAR|RESEND|OPENAI|ANTHROPIC|GEMINI)_[A-Z0-9_]+\b/g;

/**
 * A server note that names environment variables ("not configured on this server (DOCK_COPILOT_PG_URL)") in words
 * for the page, with the names kept apart for a detail an engineer can open.
 */
export function envOut(text: string | undefined | null): { text: string; names: string[] } {
  if (!text) return { text: "", names: [] };
  const names = [...new Set(text.match(ENV_NAME) ?? [])];
  if (!names.length) return { text, names };
  const out = text
    .replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (ENV_NAME.test(inner) ? ((ENV_NAME.lastIndex = 0), "") : ((ENV_NAME.lastIndex = 0), m)))
    .replace(/\b(?:set|setting)\s+(?=\b(?:DOCK|KAFKA|AIVEN|RADAR)_)/gi, "")
    .replace(ENV_NAME, "its setting")
    .replace(/\s+([.,;:])/g, "$1");
  return { text: out, names };
}

/**
 * What a request "asked": a person's or agent's own words, or a label the system wrote for its own work ("Kitchen
 * portal: live price checks for …", "Kitchen agent's watch: …"). A label is never shown in quotes, as if someone said it.
 */
export function askedWords(text: string | undefined | null): { words: string; system: boolean } {
  const t = fi(text);
  const m = /^((?:Kitchen portal|Kitchen agent's watch|Kitchen watch|Selling agent|Operations|Presenter[^:]*|The watch)): (.+)$/i.exec(t);
  return m ? { words: m[2].charAt(0).toUpperCase() + m[2].slice(1), system: true } : { words: t, system: false };
}
