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
  if (ctx.heardNumbers && ctx.spokenNumbers && ctx.heardNumbers.length && ctx.spokenNumbers.length) {
    const a = [...ctx.heardNumbers].sort((x, y) => x - y).join(",");
    const b = [...ctx.spokenNumbers].sort((x, y) => x - y).join(",");
    if (a !== b) return `the transcript heard ${ctx.heardNumbers.join(", ")} but the voice model heard ${ctx.spokenNumbers.join(", ")}`;
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
