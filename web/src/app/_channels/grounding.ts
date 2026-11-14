/**
 * The grounding check for the voice agent: what it says may only contain products, prices, amounts, dates and
 * times that came back from Dock in this call. The call screen runs this on the agent's transcript as it
 * speaks; on a mismatch it cuts the agent's audio, marks the sentence on screen as not from Dock, and tells the
 * agent to take it back. Pure functions, shared by the browser and the tests.
 *
 * What counts as a fact: every number in a tool result (cents are also read as euros), every ISO date and
 * date-time (also as weekday, day and month, and local clock time), and every product name and brand. What the
 * check looks at in speech: numbers written as digits or as number words (English, plus common Finnish and
 * Swedish ones), prices, weekday names, day-month dates, clock times, and brand names from the catalogue.
 * Small bare numbers (1 to 5, without a unit or a currency) are allowed for "option 2" or "three options".
 */

export type Facts = { numbers: Set<number>; dates: Set<string>; times: Set<string>; text: string };

export type Violation = { kind: "number" | "price" | "date" | "time" | "product"; said: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function emptyFacts(): Facts {
  return { numbers: new Set(), dates: new Set(), times: new Set(), text: "" };
}

function addNumber(f: Facts, n: number) {
  if (!Number.isFinite(n)) return;
  f.numbers.add(round2(n));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

function helsinkiTime(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** Add everything in a tool result (or any JSON) to the facts. */
export function addFacts(f: Facts, value: unknown, key = ""): Facts {
  if (value === null || value === undefined) return f;
  if (typeof value === "number") {
    addNumber(f, value);
    if (/cents$/i.test(key)) addNumber(f, value / 100);
    return f;
  }
  if (typeof value === "string") {
    f.text += ` ${value.toLowerCase()}`;
    if (ISO_DATE.test(value)) f.dates.add(value);
    else if (ISO_DATETIME.test(value)) {
      f.dates.add(value.slice(0, 10));
      f.times.add(value.slice(11, 16));
      const local = helsinkiTime(value);
      if (local) f.times.add(local);
    }
    for (const n of numbersIn(value)) addNumber(f, n.value);
    for (const m of value.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) f.dates.add(m[0]);
    for (const m of value.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) f.times.add(`${m[1].padStart(2, "0")}:${m[2]}`);
    return f;
  }
  if (Array.isArray(value)) {
    for (const v of value) addFacts(f, v, key);
    return f;
  }
  if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) addFacts(f, v, k);
  return f;
}

// ---------- numbers in speech ----------

const EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const FI: Record<string, number> = {
  nolla: 0, yksi: 1, yhden: 1, kaksi: 2, kahden: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10,
  sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, kymmentä: 10,
};
const SV: Record<string, number> = { noll: 0, en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, tjugo: 20, trettio: 30, fyrtio: 40, femtio: 50, hundra: 100, tusen: 1000 };
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, hundra: 100, tusen: 1000, miljoona: 1_000_000, miljon: 1_000_000 };

/** A Finnish compound like "kaksisataa" or "viisikymmentä" as one number, or undefined. */
function finnishCompound(w: string): number | undefined {
  const parts = ["kymmentä", "sataa", "tuhatta", "sata", "tuhat", ...Object.keys(FI).sort((a, b) => b.length - a.length)];
  let rest = w;
  let total = 0;
  let cur = 0;
  let matched = false;
  while (rest) {
    const p = parts.find((x) => rest.startsWith(x));
    if (!p) return undefined;
    rest = rest.slice(p.length);
    matched = true;
    const v = FI[p];
    if (p.startsWith("kymmen") && p !== "kymmenen") cur = (cur || 1) * 10;
    else if (v === 100) cur = (cur || 1) * 100;
    else if (v === 1000) {
      total += (cur || 1) * 1000;
      cur = 0;
    } else cur += v;
  }
  return matched ? total + cur : undefined;
}

type Found = { value: number; text: string; index: number; end: number };

/** Numbers in a text, as digits ("1,000", "12.40", "2,5") or words ("one thousand", "kaksisataa", "tvåhundra"). */
export function numbersIn(text: string): Found[] {
  const out: Found[] = [];
  // Grouped thousands ("1,000", "1 000", "12.345,50") or a plain number with up to two decimals ("12,40", "2.5").
  for (const m of text.matchAll(/(?<![\d.,])(?:\d{1,3}(?:[   ,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])/g)) {
    const raw = m[0];
    let value: number;
    const grouped = /^\d{1,3}(?:[   ,.]\d{3})+/.exec(raw);
    if (grouped) {
      const dec = raw.slice(grouped[0].length);
      value = Number(grouped[0].replace(/[   ,.]/g, "")) + (dec ? Number(`0.${dec.slice(1)}`) : 0);
    } else value = Number(raw.replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, text: raw, index: m.index!, end: m.index! + raw.length });
  }
  // number words: a run of number words and "and"/"ja"/"och" glue
  const words = [...text.toLowerCase().matchAll(/[a-zåäöé-]+/g)];
  let i = 0;
  while (i < words.length) {
    let total = 0;
    let cur = 0;
    let j = i;
    let any = false;
    while (j < words.length) {
      const w = words[j][0].replace(/-/g, "");
      const parts = words[j][0].split("-");
      let v: number | undefined = EN[w] ?? SV[w] ?? FI[w];
      if (v === undefined && parts.length === 2 && EN[parts[0]] !== undefined && EN[parts[1]] !== undefined) v = EN[parts[0]] + EN[parts[1]];
      if (v === undefined && !SCALE[w]) v = finnishCompound(w) ?? swedishCompound(w);
      if (v !== undefined && !SCALE[w]) {
        cur += v;
        any = true;
      } else if (SCALE[w]) {
        const s = SCALE[w];
        if (s === 100) cur = (cur || 1) * 100;
        else {
          total += (cur || 1) * s;
          cur = 0;
        }
        any = true;
      } else if (any && (w === "and" || w === "ja" || w === "och")) {
        // glue
      } else break;
      j++;
    }
    if (any) {
      const first = words[i];
      const last = words[j - 1];
      const value = total + cur;
      // "en"/"ett" alone are Swedish articles, "one" alone is often a pronoun: only count them with a unit after.
      const lone = j - i === 1 && ["en", "ett", "one", "a"].includes(first[0]);
      if (!lone || unitAfter(text, last.index! + last[0].length)) out.push({ value, text: text.slice(first.index!, last.index! + last[0].length), index: first.index!, end: last.index! + last[0].length });
      i = j;
    } else i++;
  }
  return out;
}

function swedishCompound(w: string): number | undefined {
  const m = /^(en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio)?(hundra|tusen)$/.exec(w);
  if (!m) return undefined;
  return (m[1] ? SV[m[1]] : 1) * SCALE[m[2]];
}

const UNIT_AFTER = /^\s*(l\b|ltr|lit|liter|litre|litra|kg\b|kilo|pack|box|boks|case|laatik|låd|back|kpl|st\b|pcs|piece|pala|kappale|kartong|purk|tölk|bag|säck|pussi|€|eur|e\b)/i;
const CURRENCY_AFTER = /^\s*(€|eur|euro|e\b|snt|cents?|senttiä)/i;

function unitAfter(text: string, end: number): boolean {
  return UNIT_AFTER.test(text.slice(end, end + 12));
}

// ---------- dates and times in speech ----------

const WEEKDAYS: string[][] = [
  ["monday", "maanantai", "måndag"],
  ["tuesday", "tiistai", "tisdag"],
  ["wednesday", "keskiviikko", "onsdag"],
  ["thursday", "torstai", "torsdag"],
  ["friday", "perjantai", "fredag"],
  ["saturday", "lauantai", "lördag"],
  ["sunday", "sunnuntai", "söndag"],
];
const MONTHS: string[][] = [
  ["january", "tammikuu", "januari"],
  ["february", "helmikuu", "februari"],
  ["march", "maaliskuu", "mars"],
  ["april", "huhtikuu", "april"],
  ["may", "toukokuu", "maj"],
  ["june", "kesäkuu", "juni"],
  ["july", "heinäkuu", "juli"],
  ["august", "elokuu", "augusti"],
  ["september", "syyskuu", "september"],
  ["october", "lokakuu", "oktober"],
  ["november", "marraskuu", "november"],
  ["december", "joulukuu", "december"],
];

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() || 7;

/**
 * Check one stretch of the agent's speech against the facts. `final` is false while the sentence is still
 * arriving: a number at the very end may be cut in half ("1,0" of "1,000"), so it is not judged yet.
 */
export function checkSpeech(spoken: string, facts: Facts, opts: { brands?: string[]; final?: boolean } = {}): Violation[] {
  const text = spoken.normalize("NFC");
  const lower = text.toLowerCase();
  const out: Violation[] = [];
  const known = (n: number) => {
    const r = round2(n);
    if (facts.numbers.has(r)) return true;
    // Speech rounds money and big amounts: "about 1,570 euros" for €1,570.31.
    for (const f of facts.numbers) if (f >= 10 && Math.round(f) === r) return true;
    return false;
  };
  for (const n of numbersIn(text)) {
    if (!opts.final && n.end >= text.trimEnd().length - 1) continue;
    const after = text.slice(n.end, n.end + 12);
    const before = text.slice(Math.max(0, n.index - 2), n.index);
    const isTime = /^:\d{2}/.test(after) || /\d:$/.test(before);
    if (isTime) continue; // judged as a time below
    const isYear = n.value >= 2020 && n.value <= 2035 && Number.isInteger(n.value);
    if (isYear) continue;
    if (/^\d{1,2}[.]\d{1,2}$/.test(n.text) && after.startsWith(".")) continue; // "16.11." is a date
    if (/^\d{1,2}$/.test(n.text) && /^\.\d{1,2}\./.test(after)) continue;
    const price = CURRENCY_AFTER.test(after) || /€\s*$/.test(before);
    const unit = UNIT_AFTER.test(after);
    if (!price && !unit && Number.isInteger(n.value) && n.value >= 1 && n.value <= 5) continue;
    // A day of the month next to a month name is judged as a date.
    if (/^\.?\s*(\d{1,2}\.|[a-zåäö]+kuuta|january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|mars|maj|juni|juli|augusti|oktober)/i.test(after) && n.value >= 1 && n.value <= 31) continue;
    if (/(january|february|march|april|may|june|july|august|september|october|november|december)\s*$/i.test(text.slice(0, n.index)) && n.value <= 31) continue;
    if (!known(n.value)) out.push({ kind: price ? "price" : "number", said: n.text });
  }
  // Clock times: "15:00", "klo 15".
  for (const m of text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)) {
    const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
    if (!facts.times.has(hhmm) && Number(m[1]) <= 23) {
      // "12.40" may be a price (handled above); only colon forms are certainly times.
      if (m[0].includes(":")) out.push({ kind: "time", said: m[0] });
    }
  }
  // Weekdays and day-month dates.
  const factDays = new Set([...facts.dates].map(weekdayOf));
  WEEKDAYS.forEach(([en], i) => {
    if (new RegExp(`\\b${en.slice(0, 3)}`, "i").test(facts.text)) factDays.add(i + 1);
  });
  WEEKDAYS.forEach((names, i) => {
    for (const name of names) {
      const re = new RegExp(`\\b${name}[a-zåäö]*`, "i");
      if (re.test(lower) && !factDays.has(i + 1)) out.push({ kind: "date", said: name });
    }
  });
  const factDayMonth = new Set([...facts.dates].map((d) => `${Number(d.slice(8, 10))}-${Number(d.slice(5, 7))}`));
  for (const m of lower.matchAll(/\b(\d{1,2})\.?\s*(?:of\s+)?([a-zåäö]+)/g)) {
    const month = MONTHS.findIndex((ns) => ns.some((n) => m[2].startsWith(n.slice(0, Math.max(3, n.length - 1)))));
    if (month >= 0 && !factDayMonth.has(`${Number(m[1])}-${month + 1}`)) out.push({ kind: "date", said: m[0] });
  }
  for (const m of lower.matchAll(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const month = MONTHS.findIndex((ns) => ns[0] === m[1]);
    if (month >= 0 && !factDayMonth.has(`${Number(m[2])}-${month + 1}`)) out.push({ kind: "date", said: m[0] });
  }
  for (const m of lower.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g)) {
    if (!factDayMonth.has(`${Number(m[1])}-${Number(m[2])}`)) out.push({ kind: "date", said: m[0] });
  }
  // Brands and products: a catalogue brand the agent names must be in a tool result.
  for (const b of opts.brands ?? []) {
    const name = b.toLowerCase().trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
    if (re.test(lower) && !facts.text.includes(name)) out.push({ kind: "product", said: b });
  }
  return dedupe(out);
}

function dedupe(v: Violation[]): Violation[] {
  const seen = new Set<string>();
  return v.filter((x) => {
    const k = `${x.kind}:${x.said.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The message the call screen sends the agent when it said something Dock never gave it. */
export function correctionFor(v: Violation[]): string {
  return `[AimoPilot check] You said ${v.map((x) => `"${x.said}"`).join(", ")}, which is not in any tool result in this call. Your audio was cut off. Tell the caller in one short sentence to ignore that, then say only what the last tool result says.`;
}
