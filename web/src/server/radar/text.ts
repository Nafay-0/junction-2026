/**
 * Plain text tools for notices in Finnish, Swedish and English: folding, pack sizes, dates, GTIN check digits and
 * sentences. Pure functions, no I/O; everything the matcher compares goes through here, so both sides of a
 * comparison are normalised the same way.
 */

const FOLD: Record<string, string> = { ä: "a", å: "a", ö: "o", ü: "u", é: "e", è: "e", á: "a", à: "a", í: "i", ó: "o", ú: "u", ñ: "n", ç: "c", ß: "ss", æ: "ae", ø: "o" };

/** Lower case, diacritics folded (ä -> a), trademark signs and punctuation gone, single spaces. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äåöüéèáàíóúñçßæø]/g, (c) => FOLD[c] ?? c)
    .replace(/[®™©*_`"'“”‘’«»]/g, "")
    .replace(/[^a-z0-9,.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** For "is this sentence on the page": whitespace, markdown marks, links and quotes ignored. */
export function squash(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> their text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[   ]/g, " ")
    .replace(/­/g, "")
    .replace(/[*_#>`|]/g, " ")
    .replace(/[“”„"«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `sentence` appears on the page (after squashing both). Very short strings never verify. */
export function appearsIn(sentence: string | undefined, pageText: string): boolean {
  if (!sentence) return false;
  const s = squash(sentence).replace(/[.;:,]+$/, "");
  if (s.length < 6) return false;
  return squash(pageText).includes(s);
}

// ---------- GTIN ----------

/** GS1 check digit for GTIN-8, -12, -13 and -14. */
export function validGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** Canonical form for comparing GTINs of different lengths: leading zeros dropped. */
export function gtinKey(code: string): string {
  return code.replace(/^0+/, "");
}

/** Every 8-, 12-, 13- or 14-digit number in the text with a valid check digit. Spaces inside a code are allowed. */
export function findGtins(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\d.,])(\d[\d ]{6,17}\d)(?![\d.,]\d)/g)) {
    const code = m[1].replace(/ /g, "");
    if (validGtin(code)) out.add(code);
  }
  return [...out];
}

// ---------- pack sizes ----------

export type PackSize = { amount: number; unit: "L" | "kg"; count: number; text: string };

const UNIT_FACTOR: Record<string, { unit: "L" | "kg"; f: number }> = {
  l: { unit: "L", f: 1 },
  ltr: { unit: "L", f: 1 },
  litra: { unit: "L", f: 1 },
  litraa: { unit: "L", f: 1 },
  liter: { unit: "L", f: 1 },
  dl: { unit: "L", f: 0.1 },
  cl: { unit: "L", f: 0.01 },
  ml: { unit: "L", f: 0.001 },
  kg: { unit: "kg", f: 1 },
  g: { unit: "kg", f: 0.001 },
  gr: { unit: "kg", f: 0.001 },
};

const PACK_RE = /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|dl|ltr|litraa|litra|liter|l)(?![a-zåäö])/i;

/** The first pack size in a name: "2,5 dl", "3x1 kg", "12x55g", "10 x Elovena 2,5dl" (count from the leading "10 x"). */
export function parsePack(text: string): PackSize | undefined {
  const m = PACK_RE.exec(text);
  if (!m) return undefined;
  const u = UNIT_FACTOR[m[3].toLowerCase()];
  if (!u) return undefined;
  const amount = round(Number(m[2].replace(",", ".")) * u.f);
  if (!(amount > 0)) return undefined;
  let count = m[1] ? Number(m[1]) : 1;
  const lead = /^\s*(\d+)\s*[x×]\s+\D/i.exec(text);
  if (!m[1] && lead) count = Number(lead[1]);
  return { amount, unit: u.unit, count, text: m[0].trim() };
}

/** Same size of one consumer pack, within 1 %. The case count is not compared: a wholesaler sells cases of them. */
export function samePack(a: PackSize | undefined, b: PackSize | undefined): boolean {
  if (!a || !b || a.unit !== b.unit) return false;
  return Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * 0.01;
}

export function describePack(p: PackSize): string {
  const each = p.unit === "L" ? (p.amount < 1 ? `${round(p.amount * 10)} dl` : `${p.amount} l`) : p.amount < 1 ? `${round(p.amount * 1000)} g` : `${p.amount} kg`;
  return (p.count > 1 ? `${p.count} x ` : "") + each.replace(".", ",");
}

/** A name without pack sizes, "10 x" prefixes and trademark signs, as folded tokens. */
export function nameTokens(name: string): string[] {
  const noPack = name
    .replace(/^\s*\d+\s*[x×]\s+/i, " ")
    .replace(new RegExp(PACK_RE.source, "gi"), " ")
    .replace(/\b\d+\s*(?:kpl|st|pcs|pc|ps)\b/gi, " ");
  return fold(noPack)
    .replace(/[,./-]/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

const STOP = new Set(["ja", "tai", "och", "eller", "and", "or", "the", "with", "for", "kpl", "st", "pcs", "x", "noin", "ca", "n"]);

/** Company names compared without their legal form and trade qualifiers: "RAVINTORAISIO OY VIILEÄ" -> ["ravintoraisio"]. */
export function companyTokens(name: string): string[] {
  return fold(name)
    .replace(/[,./-]/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !COMPANY_NOISE.has(t));
}

const COMPANY_NOISE = new Set(["oy", "oyj", "ab", "abp", "ltd", "ky", "ay", "inc", "gmbh", "as", "aps", "srl", "spa", "bv", "nv", "the", "suomi", "finland", "sverige", "sweden", "group", "tuore", "viilea", "pakaste", "kuiva", "kuivat", "tukku", "foods", "food", "trading", "company", "co"]);

/** Same company: a significant token of one appears inside a token of the other ("raisio" in "ravintoraisio"). */
export function sameCompany(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  return ta.some((x) => x.length >= 4 && tb.some((y) => y.includes(x) || (y.length >= 4 && x.includes(y))));
}

// ---------- dates ----------

const FI_MONTHS = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesakuuta", "heinakuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];
const SV_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "9. lokakuuta 2026", "9 oktober 2026", "October 9, 2026", "2026-10-09" or "9.10.2026" -> "2026-10-09". */
export function parseLongDate(text: string): string | undefined {
  const t = fold(text);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m && validDate(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})\.?\s+([a-z]+)\s+(\d{4})/.exec(t);
  if (m) {
    const month = monthIndex(m[2]);
    if (month && validDate(+m[3], month, +m[1])) return iso(+m[3], month, +m[1]);
  }
  m = /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m) {
    const month = monthIndex(m[1]);
    if (month && validDate(+m[3], month, +m[2])) return iso(+m[3], month, +m[2]);
  }
  m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m && validDate(+m[3], +m[2], +m[1])) return iso(+m[3], +m[2], +m[1]);
  return undefined;
}

function monthIndex(word: string): number | undefined {
  for (const list of [FI_MONTHS, SV_MONTHS, EN_MONTHS]) {
    const i = list.findIndex((w) => w === word || (word.length >= 3 && w.startsWith(word)));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

/**
 * Day-month dates in a stretch of text: "28.10.", "5.8.2027", "28/10", "2026-10-05". A date without a year takes
 * the year that puts it nearest after six months before `ref` (a best-before written in October means this autumn
 * or next spring, not last year's).
 */
export function findDates(text: string, ref: string): string[] {
  const out = new Set<string>();
  const refT = Date.parse(`${ref}T00:00:00Z`);
  const refYear = Number(ref.slice(0, 4));
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) if (validDate(+m[1], +m[2], +m[3])) out.add(iso(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d])/g)) {
    const d = +m[1];
    const mo = +m[2];
    let y = m[3] ? +m[3] : NaN;
    if (m[3] && m[3].length === 2) y = 2000 + y;
    if (!m[3]) {
      y = refYear;
      if (Date.UTC(y, mo - 1, d) < refT - 183 * 86400_000) y += 1;
    }
    if (validDate(y, mo, d)) out.add(iso(y, mo, d));
  }
  return [...out].sort();
}

// ---------- sentences ----------

/** Split page text into sentences, keeping dates like "28.10." and "5.8.2027" inside their sentence. */
export function sentences(text: string): string[] {
  const clean = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]/g, " ")
    .replace(/[ \t ]+/g, " ");
  const out: string[] = [];
  for (const block of clean.split(/\n\s*\n|\n(?=\s*[-•]\s)/)) {
    const b = block.replace(/\s*\n\s*/g, " ").trim();
    if (!b) continue;
    // a full stop ends a sentence unless it sits inside a number or a date ("2,5 dl." still ends one)
    const parts = b.split(/(?<=[^\d\s][.!?]|\d{3,}[.!?]|[)][.!?])\s+(?=[A-ZÅÄÖ"(])/u);
    for (const p of parts) if (p.trim().length > 2) out.push(p.trim());
  }
  return out;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
