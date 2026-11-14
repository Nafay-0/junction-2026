/**
 * Plain words and Finnish formats for the screens. Pure functions, used by server and client code alike.
 *
 * Dates as people in Finland write them (Tue 17.11., 17.11.2026), 24-hour clock with a dot (14.05),
 * always in Helsinki time. Euros as the API writes them (€1,280.50), so figures we format match the
 * sentences the API sends.
 */

export const TIME_ZONE = "Europe/Helsinki";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue 17.11." for a calendar date (YYYY-MM-DD). */
export function day(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** "17.11.2026" */
export function fullDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

function parts(iso: string | Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(typeof iso === "string" ? new Date(iso) : iso)
      .map((x) => [x.type, x.value]),
  );
  return { h: p.hour, m: p.minute, s: p.second };
}

/** "14.05" in Helsinki. */
export function clock(iso: string | Date): string {
  const { h, m } = parts(iso);
  return `${h}.${m}`;
}

/** "14.05.32" in Helsinki. */
export function clockSeconds(iso: string | Date): string {
  const { h, m, s } = parts(iso);
  return `${h}.${m}.${s}`;
}

/** Today's date in Helsinki, YYYY-MM-DD. */
export function helsinkiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function eur(cents: number): string {
  return `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "€500" for whole euros, else "€499.50". */
export function eurShort(cents: number): string {
  return cents % 100 === 0 ? `€${(cents / 100).toLocaleString("en-US")}` : eur(cents);
}

// ---------- Finnish number conventions, for the customer-facing screens ----------
// The API and the operations screens write "€1,280.50". The store and the phone pages write money and measures as
// people in Finland do: "1 280,50 €", "2,5 kg", with a no-break space between groups and before the unit.

const NBSP = " ";

/** "1 280,5" — a number with a decimal comma and no-break spaces between thousands. */
export function num(n: number, maxDigits = 2, minDigits = 0): string {
  const s = Math.abs(n).toFixed(maxDigits);
  let [int, frac = ""] = s.split(".");
  frac = frac.replace(/0+$/, "");
  while (frac.length < minDigits) frac += "0";
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${n < 0 && Number(s) !== 0 ? "−" : ""}${int}${frac ? `,${frac}` : ""}`;
}

/** "1 280,50 €" */
export function money(cents: number): string {
  return `${num(cents / 100, 2, 2)}${NBSP}€`;
}

/** "500 €" for whole euros, else "499,50 €". */
export function moneyShort(cents: number): string {
  return cents % 100 === 0 ? `${num(cents / 100, 0)}${NBSP}€` : money(cents);
}

/** Rewrite the API's English money ("€1,280.50", "€500") in a sentence into the Finnish form. */
export function fiMoney(text: string): string {
  return text.replace(/€\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?(?![\d,]*\d)/g, (_m, int: string, frac?: string) => {
    const cents = Number(int.replaceAll(",", "")) * 100 + (frac ? Number(frac.padEnd(2, "0")) : 0);
    return frac ? money(cents) : moneyShort(cents);
  });
}

/**
 * humanize() for the customer side: ids out, money as written in Finland, a rule's code as its title, and a decimal
 * before a unit with a comma ("16.2 kg" -> "16,2 kg").
 */
export function say(text: string, products: Record<string, string> = {}): string {
  return fiMoney(humanize(text, products))
    .replace(/\(([a-z]+(?:_[a-z]+)+)\)/g, (m, code: string) => (RULE_TITLE[code] ? `(${RULE_TITLE[code].toLowerCase()})` : m))
    .replace(/\b(\d+)\.(\d+)(\s?)(kg|g|l|L|dl|ml)(?![\w.])/g, (_m, a: string, b: string, sp: string, u: string) => `${a},${b}${sp || NBSP}${u}`);
}

/** "100 L", "2,5 kg", "12 pcs" with Finnish decimals. */
export function measure(n: number, unit: string): string {
  const v = num(n, 2);
  if (unit === "pack") return `${v} pack${n === 1 ? "" : "s"}`;
  if (unit === "pcs") return `${v}${NBSP}pcs`;
  return `${v}${NBSP}${unit}`;
}

export function amount(n: number, unit: string): string {
  const v = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "pack") return `${v} pack${n === 1 ? "" : "s"}`;
  if (unit === "pcs") return `${v} pcs`;
  return `${v} ${unit}`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

// ---------- the gate's rules, in plain words ----------

/** What each named check protects, as a short title a non-expert understands. Rule ids stay behind details. */
export const RULE_TITLE: Record<string, string> = {
  mandate_agent: "Only the agent named in the mandate",
  mandate_window: "The mandate must be in force",
  mandate_signature: "The mandate must be signed by the kitchen",
  quote_binding: "The price must be quoted to this kitchen",
  quote_expiry: "The fixed price must still hold",
  quote_replay: "A quote buys only once",
  quote_signature: "The price must carry the wholesaler's signature",
  quote_availability: "Only what is in stock",
  order_matches_quote: "The order must match the quote exactly",
  category_allowed: "Only product groups the kitchen allows",
  required_attributes: "Products must meet the kitchen's requirements",
  forbidden_allergens: "No forbidden allergens",
  nutrition_rules: "Nutrition rules",
  required_certificates: "Required certificates",
  delivery_deadline: "Must arrive in time",
  substitution_rule: "Swapping products needs a person",
  substitute_price: "A swap may cost only a little more",
  weekly_budget: "The weekly budget is a hard limit",
  per_order_limit: "The agent's own spending limit",
  order_splitting: "No splitting one need into small orders",
  human_confirmation: "A person confirms what matters",
  approver_authority: "Someone must be allowed to sign the amount",
  live_lookup_limit: "Live price checks for a short list only",
  approver_identity: "Only the named person can sign off",
  operator_suspension: "Suspended by the wholesaler's staff",
};

export function ruleTitle(rule: string | undefined): string {
  return (rule && RULE_TITLE[rule]) || "A rule of the gate";
}

export const ROLE_LABEL: Record<string, string> = {
  head_chef: "head chef",
  owner: "owner",
  kitchen_manager: "kitchen manager",
  finance_director: "finance director",
  purchasing_manager: "purchasing manager",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replaceAll("_", " ");
}

export const ATTRIBUTE_LABEL: Record<string, string> = {
  lactose_free: "lactose-free",
  fat_free: "fat-free",
  fat_1_5: "semi-skimmed 1.5 %",
  fat_3_5: "whole 3.5 %",
  organic: "organic",
  vegan: "vegan",
  gluten: "gluten",
  nuts: "nuts",
  plant_drink: "plant drinks",
};

export function attr(a: string): string {
  return ATTRIBUTE_LABEL[a] ?? a.replaceAll("_", " ");
}

// ---------- ids out of sentences ----------

/** "Valio Eila lactose-free semi-skimmed milk drink 1.5 %, 10 L bag-in-box" -> "Valio Eila 1.5 %, 10 L bag-in-box". */
export function shortProduct(name: string): string {
  if (!name.includes(",")) return shortCatalogueName(name);
  const [head, ...rest] = name.split(",");
  const words = head.trim().split(/\s+/);
  const brand = words.slice(0, words[1] && /^[A-Z]/.test(words[1]) ? 2 : 1).join(" ");
  const fat = /(\d+(?:\.\d+)?\s*%)/.exec(head)?.[1];
  const kind = /oat|cream|yoghurt|organic/i.exec(head)?.[0]?.toLowerCase();
  const pack = rest.join(",").trim();
  return [brand, kind, fat].filter(Boolean).join(" ") + (pack ? `, ${pack}` : "");
}

/**
 * The partner's own product names have no comma and can be long ("Valio Hyvä suomalainen Arki® Eila® semi skimmed
 * milk drink 1 l lactose free"): drop the trademark signs and, when too long, cut at a word but keep the pack size.
 */
function shortCatalogueName(name: string, max = 48): string {
  const clean = name.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const pack = /\b\d+(?:[.,]\d+)?\s?(?:x\s?\d+(?:[.,]\d+)?\s?)?(?:l|L|dl|cl|ml|kg|g)\b/.exec(clean)?.[0];
  const room = pack ? max - pack.length - 3 : max - 1;
  const cut = clean.slice(0, room).replace(/\s+\S*$/, "");
  return pack && !cut.includes(pack) ? `${cut}…, ${pack}` : `${cut}…`;
}

/**
 * Take internal ids out of a sentence the API wrote: product codes become short product names,
 * order/quote/agent ids become plain nouns. The raw text stays available behind a details control.
 */
export function humanize(text: string, products: Record<string, string> = {}): string {
  let out = text;
  for (const [id, name] of Object.entries(products)) out = out.replaceAll(id, shortProduct(name));
  return out
    .replace(/ \((?:order )?ord_[a-z0-9]+\)/gi, "")
    .replace(/\bquoted qt_[a-z0-9]+/gi, "fixed a price")
    .replace(/\border ord_[a-z0-9]+/gi, "the order")
    .replace(/\bord_[a-z0-9]+/gi, "the order")
    .replace(/\bquote qt_[a-z0-9]+/gi, "the quote")
    .replace(/\bQuote qt_[a-z0-9]+/g, "The quote")
    .replace(/\bqt_[a-z0-9]+/gi, "the quote")
    .replace(/\bAgent agent_[a-z0-9_]+ of /g, "The agent of ")
    .replace(/\bagent agent_[a-z0-9_]+/gi, "the agent")
    .replace(/\bagent_[a-z0-9_]+/gi, "the agent")
    .replace(/\breq_[a-z0-9]+/gi, "the request")
    .replace(/\bapr_[a-z0-9]+/gi, "the sign-off")
    .replace(/\bopt_(\d+)/g, "option $1")
    .replace(/ \((?:head_chef|owner|kitchen_manager|finance_director|purchasing_manager)\)/g, (m) => ` (${roleLabel(m.slice(2, -1))})`)
    .replace(/(\d{1,2}):(\d{2}) UTC/g, (_m, h: string, mm: string) => utcClockToHelsinki(h, mm))
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b\.?/g, (_m, y: string, mo: string, d: string) => day(`${y}-${mo}-${d}`))
    .replace(/\bcorrected ([a-z_]+): /g, (_m, code: string) => `corrected ${CONCERN_WORD[code] ?? "the request"}: `)
    .replace(/^([a-z]+(?:_[a-z0-9]+)+): /, "")
    .replace(/\bDock\b/g, "AimoPilot")
    .replace(/\b(lactose_free|fat_1_5|fat_3_5|fat_free|plant_drink)\b/g, (m) => attr(m));
}

/** What a mistake check was about, for sentences like "corrected the amount". */
const CONCERN_WORD: Record<string, string> = {
  quantity_tenfold: "the amount",
  readings_differ: "the reading",
  quantity_unusual: "the amount",
  unit_confusion: "the unit",
  unit_unclear: "the unit",
  duplicate_recent: "a possible duplicate",
  delivery_in_past: "the delivery day",
  delivery_not_delivery_day: "the delivery day",
  delivery_after_cutoff: "the delivery day",
  contradicts_preference: "a kitchen rule",
  large_first_order: "the amount",
  nothing_to_repeat: "the repeat order",
};

function utcClockToHelsinki(h: string, m: string): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(h), Number(m)));
  return `${clock(d)} Helsinki time`;
}

/** Who did it, in words: "agent:agent_x" -> "Agent", "buyer:Sanna" -> "Sanna", "approver:head_chef" -> "Head chef". */
export function actorLabel(actor: string, names: { agent?: string } = {}): string {
  if (actor === "dock") return "AimoPilot";
  if (actor.startsWith("agent:")) return names.agent ?? "Buyer agent";
  if (actor.startsWith("buyer:")) return actor.slice(6);
  if (actor.startsWith("approver:")) {
    const r = roleLabel(actor.slice(9));
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  return "Unknown caller";
}

// ---------- an order's timeline: facts fit to read ----------

/** The kinds of card the conversation showed, as words ("Shown: understood, anomaly"). */
const CARD_WORD: Record<string, string> = {
  understood: "what it understood",
  anomaly: "a check",
  question: "a question",
  options: "the options",
  price: "the fixed price",
  gate: "the rules check",
  order: "the order",
  offer: "an offer",
  memory: "memory",
  records: "records",
  notice: "a notice",
  sheet: "the order sheet",
  alternatives: "alternatives",
  menu: "a menu",
};

/** A value that is an id or a hash: kept for engineers (on hover or in details), never a visible label. */
export function isRawId(value: string): boolean {
  return /^(?:qt|ord|req|apr|agent|thr|wf|run|off|sus|sbx|clm|msg)_[A-Za-z0-9_]+$/.test(value.trim()) || /^[0-9a-f]{12,}…?$/i.test(value.trim()) || /^order digest /i.test(value.trim());
}

/** One timeline fact as read: card kinds in words; `id` when the value is an id or hash (show it only on request). */
export function timelineFact(f: { label: string; value: string }): { label: string; value: string; id: boolean } {
  if (f.label === "Shown") return { label: "Showed", value: f.value.split(/,\s*/).map((k) => CARD_WORD[k] ?? k.replaceAll("_", " ")).join(", "), id: false };
  return { ...f, id: isRawId(f.value) };
}
