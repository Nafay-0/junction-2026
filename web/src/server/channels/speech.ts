import { numbersIn } from "@/core/grounding";
import { formatAmount, type NeedUnit, type StructuredNeed } from "@/core/need";

/**
 * Plain code for the spoken door: when to read an amount back, how to say it, and whether what a person said
 * was a yes or a no. No model is involved here; the voice model only relays what these functions decide.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
    if (n) parts.push("and");
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  else if (n > 0 || parts.length === 0) parts.push(ONES[n]);
  return parts.join(" ");
}

/** 1000 -> "one thousand", 2.5 -> "two point five". English: the voice model says it in the buyer's language. */
export function numberInWords(x: number): string {
  if (!Number.isFinite(x) || x < 0) return String(x);
  const whole = Math.floor(x);
  const frac = Math.round((x - whole) * 100);
  const chunks: string[] = [];
  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1000);
  const rest = whole % 1000;
  if (millions) chunks.push(`${under1000(millions)} million`);
  if (thousands) chunks.push(`${under1000(thousands)} thousand`);
  if (rest || chunks.length === 0) chunks.push(under1000(rest));
  let s = chunks.join(" ");
  if (frac) s += ` point ${String(frac).padStart(2, "0").replace(/0$/, "").split("").map((d) => ONES[Number(d)]).join(" ")}`;
  return s;
}

const UNIT_WORDS: Record<NeedUnit, [string, string]> = { L: ["litre", "litres"], kg: ["kilo", "kilos"], pcs: ["piece", "pieces"], pack: ["pack", "packs"] };

export function amountInWords(amount: number, unit: NeedUnit): string {
  const [one, many] = UNIT_WORDS[unit];
  return `${numberInWords(amount)} ${amount === 1 ? one : many}`;
}

export type UsualAmount = { family: string; amount: number; unit: string };

/** Amounts above these, with no history to compare against, are read back. */
const FIRST_TIME_LIMIT: Record<NeedUnit, number> = { L: 200, kg: 100, pcs: 200, pack: 20 };
const ALWAYS_READ_BACK_FROM = 1000;

/**
 * Whether the spoken amount must be read back before anything happens, and why. A mis-heard number in a loud
 * kitchen ("fifteen" for "fifty") is the costliest mistake this door can make, so the rule leans towards asking
 * when the amount is far from what this kitchen usually orders, or when the two transcriptions disagree.
 */
export function readBackReason(need: StructuredNeed, ctx: { usual: UsualAmount[]; heardNumbers?: number[]; spokenNumbers?: number[] }): string | undefined {
  const q = need.quantity;
  if (!q) return undefined;
  // Two hearings of the same words: the transcript (what AimoPilot reads) and the voice model's own rendering. When
  // one has the amount and the other does not, the room was loud enough to matter: say both.
  const h = ctx.heardNumbers ?? [];
  const s = ctx.spokenNumbers ?? [];
  if (h.length && s.length) {
    const near = (xs: number[]) => xs.some((x) => Math.abs(x - q.amount) < 1e-6 * Math.max(1, q.amount));
    if (near(h) !== near(s)) return `the transcript heard ${[...new Set(h)].join(", ")} but the voice model heard ${[...new Set(s)].join(", ")}`;
  }
  if (q.unit === "pack") return "a number of packs depends on the pack size, so the amount is confirmed";
  if (q.amount >= ALWAYS_READ_BACK_FROM) return `${formatAmount(q.amount, q.unit)} is a large amount`;
  const text = `${need.item.category ?? ""} ${need.item.text}`.toLowerCase();
  const usual = ctx.usual.find((u) => u.unit === q.unit && (u.family === need.item.category || text.includes(u.family.toLowerCase())));
  if (usual) {
    const ratio = q.amount / usual.amount;
    if (ratio >= 2.5) return `this kitchen usually orders about ${formatAmount(usual.amount, q.unit)} of ${usual.family}`;
    if (ratio <= 0.4) return `this kitchen usually orders about ${formatAmount(usual.amount, q.unit)} of ${usual.family}, much more than this`;
    return undefined;
  }
  if (q.amount > FIRST_TIME_LIMIT[q.unit]) return `there is no earlier order to compare ${formatAmount(q.amount, q.unit)} with`;
  return undefined;
}

/** Numbers in a transcript, as digits or words in the three languages, with halves ("two and a half" -> 2, 2.5). */
export function numbersHeard(text: string): number[] {
  return numbersIn(text).map((n) => n.value);
}

/** Numbers written as digits in a transcript: "1,000 L" -> [1000], "2,5 kg" -> [2.5]. Number words are not parsed. */
export function digitsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d\s,.  ]*\d|\d/g)) {
    let s = m[0].replace(/[\s  ]/g, "");
    // 1,000 / 1.000 as thousands; 2,5 / 2.5 as decimals.
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
    else s = s.replace(",", ".");
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const YES = /(?<![\p{L}\p{N}])(yes|yeah|yep|yup|correct|right|exactly|sure|ok|okay|confirm(ed)?|go ahead|place it|do it|kyllä|kylla|joo|juu|jep|kyl|oikein|just niin|selvä|tilaa|ja|japp|jo|precis|stämmer|stammer|rätt|ratt|okej|kör|beställ)(?![\p{L}\p{N}])/iu;
const NO = /(?<![\p{L}\p{N}])(no|nope|not|wrong|don'?t|stop|cancel|wait|ei|älä|ala|väärin|varin|peru|odota|nej|inte|fel|vänta|avbryt)(?![\p{L}\p{N}])/iu;

/** "yes" | "no" | "unclear", from what the person said. A sentence with both counts as unclear. */
export function yesOrNo(text: string): "yes" | "no" | "unclear" {
  const t = text.normalize("NFC").toLowerCase();
  const yes = YES.test(t);
  const no = NO.test(t);
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

const FI_WORDS = /(?<![\p{L}])(tarvitsen|tarvitsemme|tarvitaan|litraa|kiloa|laatikkoa|kappaletta|kpl|ja|kiitos|maitoa|kermaa|voita|rahkaa|juustoa|kananmunaa|kyllä|joo|ei|on|se|oikein|tilaa|ensimmäinen|toinen|huomiseksi|huomenna|maanantaiksi|tiistaiksi|keskiviikoksi|torstaiksi|perjantaiksi|lauantaiksi|sunnuntaiksi)(?![\p{L}])/giu;
const SV_WORDS = /(?<![\p{L}])(vi|behöver|jag|och|till|liter|kilo|lådor|tack|mjölk|grädde|smör|ost|ägg|ja|nej|det|stämmer|beställ|första|andra|imorgon|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?![\p{L}])/giu;
const EN_WORDS = /(?<![\p{L}])(i|we|need|the|of|for|please|litres|liters|kilos|cases|boxes|eggs|milk|cream|butter|yes|no|and|some|can|get)(?![\p{L}])/giu;

/** The language a caller spoke in, from marker words: what the agent should answer in. Undefined when unclear. */
export function languageOf(text: string): "en" | "fi" | "sv" | undefined {
  const t = text.normalize("NFC");
  const fi = (t.match(FI_WORDS) ?? []).length + (/(aa|ää|iksi)\b/i.test(t) ? 1 : 0);
  const sv = (t.match(SV_WORDS) ?? []).length + (/å/i.test(t) ? 1 : 0);
  const en = (t.match(EN_WORDS) ?? []).length;
  const best = Math.max(fi, sv, en);
  if (best === 0) return undefined;
  if (fi === best && fi > sv && fi > en) return "fi";
  if (sv === best && sv > fi && sv > en) return "sv";
  if (en === best && en > fi && en > sv) return "en";
  return undefined;
}

export const LANGUAGE_NAME = { en: "English", fi: "Finnish", sv: "Swedish" } as const;
