/**
 * The grounding check: one check for every place where text a model wrote reaches a person (the voice agent's
 * speech, the assistant panel's answers, the menu planner's lines and reasons, the interpreter's output, memory
 * proposals, the Aiven agent's transcript in the operations portal). What the model says may only contain
 * products, prices, amounts, dates, times, dietary claims and allergen statements that the data behind it backs:
 * the catalogue records, a live lookup, the ledger or the kitchen's memory, handed in as plain data.
 *
 * The call screen runs `checkSpeech` on the agent's transcript as it speaks; on a mismatch it cuts the agent's
 * audio, marks the sentence on screen as not from Dock, and tells the agent to take it back. Written text goes
 * through `groundText`, which replaces every sentence that says something the data does not back with "The data
 * does not say." before it is shown. Pure functions, no model, no server code: shared by the browser, the server
 * and the tests.
 *
 * What counts as a fact: every number in a tool result (cents are also read as euros), every ISO date and
 * date-time (also as weekday, day and month, and local clock time), and every product name and brand. What the
 * check looks at in speech: numbers written as digits or as number words (English, plus common Finnish and
 * Swedish ones), prices, weekday names, day-month dates, clock times, and brand names from the catalogue.
 * Small bare numbers (1 to 5, without a unit or a currency) are allowed for "option 2" or "three options".
 */

export type Facts = {
  numbers: Set<number>;
  dates: Set<string>;
  times: Set<string>;
  text: string;
  /** Dietary claims the data states (lactose_free, gluten_free, vegan, organic, ...). */
  claims: Set<string>;
  /** Allergens the data says a product contains or may contain. */
  allergensPresent: Set<string>;
  /** Allergens the data says a product is free from (a declared "free from" list, or a statement in the data). */
  allergensFree: Set<string>;
  /** Allergens a rule forbids (the mandate, a remembered rule): backs "the kitchen allows no nuts", not "this is nut-free". */
  allergensRuled: Set<string>;
};

export type Violation = { kind: "number" | "price" | "date" | "time" | "product" | "claim" | "allergen"; said: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function emptyFacts(): Facts {
  return { numbers: new Set(), dates: new Set(), times: new Set(), text: "", claims: new Set(), allergensPresent: new Set(), allergensFree: new Set(), allergensRuled: new Set() };
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

/** Keys under which the data lists allergens, and what each list says. */
const PRESENT_KEYS = /^(contains|mayContain|may_contain|allergens|traces)$/i;
const FREE_KEYS = /^(freeFrom|statedFreeFrom|free_from|notAllergens)$/i;
const RULED_KEYS = /^(forbiddenAllergens|forbidden_allergens|excludedAllergens)$/i;

/**
 * Add everything in a tool result (or any JSON) to the facts. `words`: the text is a person's own words (the
 * buyer's question): its numbers, dates and names count, but a claim or allergen statement in it backs nothing,
 * or "is this nut-free?" would back the answer "yes, it is nut-free".
 */
export function addFacts(f: Facts, value: unknown, key = "", trust: "data" | "words" = "data"): Facts {
  if (value === null || value === undefined) return f;
  if (typeof value === "number") {
    addNumber(f, value);
    if (/cents$/i.test(key)) addNumber(f, value / 100);
    if (value > 0 && value <= 1 && !Number.isInteger(value)) addNumber(f, value * 100); // a share said as a percentage
    return f;
  }
  if (typeof value === "boolean") return f;
  if (typeof value === "string") {
    f.text += ` ${value.toLowerCase()}`;
    if (trust === "data") {
      const listed = allergenCode(value);
      if (listed && PRESENT_KEYS.test(key)) f.allergensPresent.add(listed);
      else if (listed && FREE_KEYS.test(key)) f.allergensFree.add(listed);
      else if (listed && RULED_KEYS.test(key)) f.allergensRuled.add(listed);
      for (const c of claimsIn(value)) if (!c.negated) f.claims.add(c.claim);
      for (const a of allergenStatementsIn(value)) (a.polarity === "free" ? f.allergensFree : f.allergensPresent).add(a.allergen);
      // A fat tag ("fat_1_5") is a figure: 1.5 %.
      for (const m of value.matchAll(/\bfat_(\d+)(?:_(\d+))?\b/g)) addNumber(f, Number(`${m[1]}${m[2] ? `.${m[2]}` : ""}`));
    }
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
    for (const v of value) addFacts(f, v, key, trust);
    return f;
  }
  if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) addFacts(f, v, k, trust);
  return f;
}

/** A person's own words (a question, a request): their numbers, dates and names back what repeats them. */
export function addWords(f: Facts, text: string | null | undefined): Facts {
  return text ? addFacts(f, text, "", "words") : f;
}

/** Facts from several pieces of data at once. */
export function factsFrom(...data: unknown[]): Facts {
  const f = emptyFacts();
  for (const d of data) addFacts(f, d);
  return f;
}

// ---------- numbers in speech ----------

const EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // "double the usual 100 litres": the 2 that backs 200
  double: 2, twice: 2,
};
const FI: Record<string, number> = {
  nolla: 0, yksi: 1, yhden: 1, kaksi: 2, kahden: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10,
  sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, kymmentä: 10, tupla: 2, tuplat: 2, kaksinkertainen: 2, kaksinkertaisesti: 2,
};
const SV: Record<string, number> = {
  dubbelt: 2, dubbla: 2, noll: 0, en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10,
  elva: 11, tolv: 12, tretton: 13, fjorton: 14, femton: 15, sexton: 16, sjutton: 17, arton: 18, nitton: 19,
  tjugo: 20, trettio: 30, fyrtio: 40, femtio: 50, sextio: 60, sjuttio: 70, åttio: 80, nittio: 90, hundra: 100, tusen: 1000,
};
/** Counted in twelves: "a dozen", "two dozen", "kaksi tusinaa", "två dussin". */
const DOZEN = new Set(["dozen", "dozens", "tusina", "tusinaa", "tusinan", "tusinoittain", "dussin", "dussinet"]);
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, hundra: 100, tusen: 1000, miljoona: 1_000_000, miljon: 1_000_000 };

/** A Finnish compound like "kaksisataa" or "viisikymmentä" as one number, or undefined. */
function finnishCompound(w: string): number | undefined {
  const parts = ["kymmentä", "toista", "sataa", "tuhatta", "sata", "tuhat", ...Object.keys(FI).sort((a, b) => b.length - a.length)];
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
    if (p === "toista") cur += 10; // "kuusitoista": six-over-ten, 16
    else if (p.startsWith("kymmen") && p !== "kymmenen") cur = (cur || 1) * 10;
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
    let lastNum = i; // the run's last number word: trailing glue ("two and") is not part of the number
    while (j < words.length) {
      const w = words[j][0].replace(/-/g, "");
      const parts = words[j][0].split("-");
      let v: number | undefined = EN[w] ?? SV[w] ?? FI[w];
      if (v === undefined && parts.length === 2 && EN[parts[0]] !== undefined && EN[parts[1]] !== undefined) v = EN[parts[0]] + EN[parts[1]];
      if (v === undefined && !SCALE[w] && !DOZEN.has(w)) v = finnishCompound(w) ?? swedishCompound(w);
      if (DOZEN.has(w)) {
        cur = (cur || 1) * 12;
        any = true;
        lastNum = j;
      } else if (v !== undefined && !SCALE[w]) {
        cur += v;
        any = true;
        lastNum = j;
      } else if (SCALE[w]) {
        lastNum = j;
        const s = SCALE[w];
        if (s === 100) cur = (cur || 1) * 100;
        else {
          total += (cur || 1) * s;
          cur = 0;
        }
        any = true;
      } else if (any && (w === "and" || w === "ja" || w === "och") && !halfFollows(words, j)) {
        // glue
      } else break;
      j++;
    }
    if (any) {
      j = lastNum + 1;
      const first = words[i];
      const last = words[j - 1];
      const value = total + cur;
      // "en"/"ett" alone are Swedish articles, "one" alone is often a pronoun: only count them with a unit after.
      const lone = j - i === 1 && ["en", "ett", "one", "a"].includes(first[0]);
      const endsAt = last.index! + last[0].length;
      if (!lone || unitAfter(text, endsAt) || HALF_AFTER.test(text.slice(endsAt))) out.push({ value, text: text.slice(first.index!, last.index! + last[0].length), index: first.index!, end: last.index! + last[0].length });
      i = j;
    } else i++;
  }
  return [...out, ...fractions(text, out)];
}

/** A Swedish compound like "tvåhundra", "hundratio" or "trettiofem" as one number, or undefined. */
function swedishCompound(w: string): number | undefined {
  const parts = Object.keys(SV).filter((k) => k !== "noll" && !k.startsWith("dubb")).sort((a, b) => b.length - a.length);
  let rest = w;
  let total = 0;
  let cur = 0;
  let pieces = 0;
  while (rest) {
    const p = parts.find((x) => rest.startsWith(x));
    if (!p) return undefined;
    rest = rest.slice(p.length);
    pieces++;
    const v = SV[p];
    if (v === 100) cur = (cur || 1) * 100;
    else if (v === 1000) {
      total += (cur || 1) * 1000;
      cur = 0;
    } else cur += v;
  }
  return pieces > 1 ? total + cur : undefined;
}

const HALVES = new Set(["half", "halv", "halvt", "puoli"]);
/** "and a half" / "och ett halvt" / "ja puoli" starts at the glue word `j`: the number ends before it. */
function halfFollows(words: RegExpMatchArray[], j: number): boolean {
  const a = words[j + 1]?.[0];
  const b = words[j + 2]?.[0];
  return HALVES.has(a ?? "") || (["a", "an", "one", "en", "ett"].includes(a ?? "") && HALVES.has(b ?? ""));
}

const HALF_AFTER = /^\s+(?:and|ja|och)\s+(?:a\s+|one\s+|an?\s+|en\s+|ett\s+)?(?:half|halv|halvt|puoli)\b/i;
const SLASH_HALF_AFTER = /^\s*(?:and\s+|ja\s+|och\s+)?(?:1\/2|½)/i;
const POINT_AFTER = /^\s+(?:point|pilkku|komma)\s+/i;

/**
 * Amounts with a fraction, as people say them: "two and a half", "2 and 1/2", "kaksi ja puoli", "två och ett
 * halvt", "puolitoista" (one and a half), "two point five". Added to the whole numbers already found.
 */
function fractions(text: string, found: Found[]): Found[] {
  const out: Found[] = [];
  for (const n of found) {
    const after = text.slice(n.end);
    const half = HALF_AFTER.exec(after) ?? SLASH_HALF_AFTER.exec(after);
    if (half) out.push({ value: n.value + 0.5, text: text.slice(n.index, n.end + half[0].length), index: n.index, end: n.end + half[0].length });
    const point = POINT_AFTER.exec(after);
    if (point) {
      const next = found.find((m) => m.index === n.end + point[0].length && m.value < 100 && Number.isInteger(m.value));
      if (next) out.push({ value: n.value + next.value / 10 ** String(next.value).length, text: text.slice(n.index, next.end), index: n.index, end: next.end });
    }
  }
  for (const m of text.matchAll(/(?<![\p{L}])(puolitoista|halvannan)(?![\p{L}])/giu)) out.push({ value: 1.5, text: m[0], index: m.index!, end: m.index! + m[0].length });
  return out;
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

/** The month a word names (0-based), by the longest matching name: Finnish "marraskuuta" is November, not Swedish "mars". */
function monthOf(word: string): number {
  let best = -1;
  let len = 0;
  MONTHS.forEach((ns, i) => {
    for (const n of ns) {
      const stem = n.slice(0, Math.max(3, n.length - 1));
      if (word.startsWith(stem) && stem.length > len) {
        best = i;
        len = stem.length;
      }
    }
  });
  return best;
}

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() || 7;

/**
 * Check one stretch of the agent's speech against the facts. `final` is false while the sentence is still
 * arriving: a number at the very end may be cut in half ("1,0" of "1,000"), so it is not judged yet.
 */
export type CheckOptions = {
  /** Brand names from the catalogue: one named in the text must be in the data. */
  brands?: string[];
  /** false while a sentence is still arriving (speech): a number at the very end is not judged yet. */
  final?: boolean;
  /** Also check dietary claims and allergen statements (default true). */
  safety?: boolean;
  /**
   * false: amounts are not judged, prices still are. For text that is by definition a stated estimate, shown as such
   * (the menu planner's portion sizes and the working behind its per-cover amounts, which the chef edits).
   */
  numbers?: boolean;
};

/** The voice door's name for the check; the same function as `checkText`. */
export function checkSpeech(spoken: string, facts: Facts, opts: CheckOptions = {}): Violation[] {
  return checkText(spoken, facts, opts);
}

/** Everything in a piece of model text that the facts do not back. */
export function checkText(spoken: string, facts: Facts, opts: CheckOptions = {}): Violation[] {
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
    if (/^\d{1,2}[.]\d{1,2}$/.test(n.text) && after.startsWith(".") && !/€\s*$/.test(before)) continue; // "16.11." is a date
    if (/^\d{1,2}$/.test(n.text) && /^\.\d{1,2}\./.test(after)) continue;
    const price = CURRENCY_AFTER.test(after) || /€\s*$/.test(before);
    const unit = UNIT_AFTER.test(after);
    if (!price && !unit && Number.isInteger(n.value) && n.value >= 1 && n.value <= 5) continue;
    if (!price && opts.numbers === false) continue;
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
    const month = monthOf(m[2]);
    if (month >= 0 && !factDayMonth.has(`${Number(m[1])}-${month + 1}`)) out.push({ kind: "date", said: m[0] });
  }
  for (const m of lower.matchAll(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const month = MONTHS.findIndex((ns) => ns[0] === m[1]);
    if (month >= 0 && !factDayMonth.has(`${Number(m[2])}-${month + 1}`)) out.push({ kind: "date", said: m[0] });
  }
  for (const m of lower.matchAll(/(?<![\d€.,]\s?)\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g)) {
    if (!factDayMonth.has(`${Number(m[1])}-${Number(m[2])}`)) out.push({ kind: "date", said: m[0] });
  }
  // Brands and products: a catalogue brand the agent names must be in a tool result.
  for (const b of opts.brands ?? []) {
    const name = b.toLowerCase().trim();
    if (name.length < 3 || COMMON_WORD_BRANDS.has(name)) continue;
    const re = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
    if (re.test(lower) && !facts.text.includes(name)) out.push({ kind: "product", said: b });
  }
  if (opts.safety !== false) out.push(...checkSafety(text, facts));
  return dedupe(out);
}

/**
 * Catalogue brands that are also ordinary words ("Fresh", "Royal", "Sun", "Start"): a sentence using the word is
 * not naming the brand often enough that checking it would strike good text. A wrong product of such a brand is
 * still caught by its figures, and the gate never takes a product from text.
 */
export const COMMON_WORD_BRANDS = new Set([
  "royal", "sun", "start", "prep", "cricket", "fresh", "super", "choice", "mission", "neutral", "buffet", "pick", "always", "duck", "jordan",
  "brazil", "prima", "mars", "via", "spring", "sure", "crops", "flora", "melissa", "magnum", "tropic", "amigo", "olymp", "felix", "dove",
  "panda", "salud", "semper", "nalle", "sisu", "juusto", "kymppi", "talvi", "helmi", "keiju", "mestari", "kruunu", "vip", "aino", "eura",
  "aimo", "havi", "prix", "abba", "anyday", "evryday", "wilder", "baba", "hai", "saga", "sampo", "cif", "omo", "bic", "modo", "heti",
  "dion", "fria", "halva", "suma", "taffel", "bonne", "prima", "ista", "pago", "familia", "metos", "sosa", "bunn", "fairy", "glade",
  "start", "kalas", "danaeg", "favero", "finess", "aspelin", "salomon", "promix", "kinder", "lotus", "milk", "cream", "butter", "oat",
  "classic", "gold", "chef", "menu", "kitchen", "natural", "pure", "best", "smart", "daily", "home", "country", "garden", "fine", "basic",
]);

// ---------- dietary claims and allergen statements ----------

export type Claim = "lactose_free" | "low_lactose" | "gluten_free" | "milk_free" | "egg_free" | "nut_free" | "vegan" | "vegetarian" | "organic";

/** Each claim in English, Finnish and Swedish, also as the data's tags ("lactose_free"). */
const CLAIM_RES: [Claim, RegExp][] = [
  ["lactose_free", /(?<![\p{L}\p{N}])lactose[\s_-]*free(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])laktoositon\p{L}*|(?<![\p{L}\p{N}])laktosfri\p{L}*/giu],
  ["low_lactose", /(?<![\p{L}\p{N}])low[\s_-]*lactose(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])vähälaktoos\p{L}*|(?<![\p{L}\p{N}])laktosreducerad\p{L}*|(?<![\p{L}\p{N}])låglaktos\p{L}*/giu],
  ["gluten_free", /(?<![\p{L}\p{N}])gluten[\s_-]*free(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])gluteeniton\p{L}*|(?<![\p{L}\p{N}])glutenfri\p{L}*/giu],
  ["milk_free", /(?<![\p{L}\p{N}])(?:milk|dairy)[\s_-]*free(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])maidoton\p{L}*|(?<![\p{L}\p{N}])mjölkfri\p{L}*/giu],
  ["egg_free", /(?<![\p{L}\p{N}])eggs?[\s_-]*free(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])munaton\p{L}*|(?<![\p{L}\p{N}])äggfri\p{L}*/giu],
  ["nut_free", /(?<![\p{L}\p{N}])(?:tree[\s_-]*)?nuts?[\s_-]*free(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])pähkinätön\p{L}*|(?<![\p{L}\p{N}])nötfri\p{L}*/giu],
  ["vegan", /(?<![\p{L}\p{N}])vegan(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])vegaani\p{L}*|(?<![\p{L}\p{N}])vegansk\p{L}*/giu],
  ["vegetarian", /(?<![\p{L}\p{N}])vegetarian(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])kasvis\p{L}*|(?<![\p{L}\p{N}])vegetarisk\p{L}*/giu],
  ["organic", /(?<![\p{L}\p{N}])organic(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])luomu\p{L}*|(?<![\p{L}\p{N}])ekologisk\p{L}*/giu],
];

/** A claim that is also a statement about one allergen. */
const CLAIM_ALLERGEN: Partial<Record<Claim, string>> = { gluten_free: "gluten", milk_free: "milk", egg_free: "eggs", nut_free: "nuts", lactose_free: "lactose" };

/** Allergen words, to the data's codes (core/catalog.ts allergens). Order matters: peanuts before nuts. */
const ALLERGEN_WORDS: [string, string][] = [
  ["peanuts", "peanuts?|maapähkinä\\p{L}*|jordnötter|jordnöt"],
  ["nuts", "(?:tree[\\s-]*)?nuts?|pähkinä\\p{L}*|pähkinöi\\p{L}*|nötter|nöt"],
  ["milk", "milk|dairy|maito\\p{L}*|maidon|mjölk"],
  ["lactose", "lactose|laktoosi\\p{L}*|laktos"],
  ["eggs", "eggs?|kananmun\\p{L}*|kananmuna\\p{L}*|ägg"],
  ["gluten", "gluten|gluteeni\\p{L}*"],
  ["wheat", "wheat|vehnä\\p{L}*|vete"],
  ["soy", "soya?|soija\\p{L}*|soja"],
  ["fish", "fish|kalaa|fisk"],
  ["crustaceans", "crustaceans?|shellfish|äyriäi\\p{L}*|skaldjur"],
  ["molluscs", "molluscs?|nilviäi\\p{L}*|blötdjur"],
  ["sesame", "sesame|seesami\\p{L}*|sesam"],
  ["celery", "celery|selleri\\p{L}*"],
  ["mustard", "mustard|sinappi\\p{L}*|senap"],
  ["lupin", "lupin\\p{L}*"],
  ["sulphites", "sulphites?|sulfites?|sulfiit\\p{L}*"],
];
const ALLERGEN_ALT = ALLERGEN_WORDS.map(([, re]) => re).join("|");

/** The data's code for an allergen word, or undefined. */
export function allergenCode(word: string): string | undefined {
  const w = word.toLowerCase().trim().replace(/_/g, " ");
  if (!w || w.length > 30) return undefined;
  for (const [code, re] of ALLERGEN_WORDS) if (new RegExp(`^(?:${re})$`, "iu").test(w)) return code;
  return undefined;
}

const NEGATION_BEFORE = /(?:(?<![\p{L}\p{N}])not|(?<![\p{L}\p{N}])isn't|(?<![\p{L}\p{N}])isnt|(?<![\p{L}\p{N}])aren't|(?<![\p{L}\p{N}])non|(?<![\p{L}\p{N}])never|(?<![\p{L}\p{N}])ei|(?<![\p{L}\p{N}])eikä|(?<![\p{L}\p{N}])inte|(?<![\p{L}\p{N}])ej|(?<![\p{L}\p{N}])no longer)[\s-]+(?:\p{L}+[\s-]+){0,2}$/iu;

/** Dietary claims a text makes. `negated`: "not lactose-free", which claims nothing and is never judged. */
export function claimsIn(text: string): { claim: Claim; said: string; negated: boolean }[] {
  const out: { claim: Claim; said: string; negated: boolean }[] = [];
  for (const [claim, re] of CLAIM_RES) {
    for (const m of text.matchAll(re)) out.push({ claim, said: m[0], negated: NEGATION_BEFORE.test(text.slice(Math.max(0, m.index! - 24), m.index!)) });
  }
  return out;
}

const FREE_RES = [
  new RegExp(`(?<![\\p{L}\\p{N}])(?:no|without|free (?:from|of)|contains? no|does not contain|doesn't contain|do not contain|don't contain|not contain|zero|ilman|ei sisällä|ei sisällä lainkaan|utan|innehåller inte|innehåller ingen|inga|ingen)\\s+(?:any\\s+|added\\s+|traces of\\s+)?(${ALLERGEN_ALT})(?![\\p{L}\\p{N}])`, "giu"),
  new RegExp(`(?<![\\p{L}\\p{N}])(${ALLERGEN_ALT})[\\s-]*(?:free|safe)(?![\\p{L}\\p{N}])`, "giu"),
];
const PRESENT_RES = [new RegExp(`(?<![\\p{L}\\p{N}])(?:contains|containing|may contain|can contain|traces of|includes?|sisältää|voi sisältää|innehåller|kan innehålla|spår av)\\s+(?:\\p{L}+[\\s,]+){0,3}?(${ALLERGEN_ALT})(?![\\p{L}\\p{N}])`, "giu")];

/** Allergen statements a text makes: "contains no nuts" (free), "may contain sesame" (present). */
export function allergenStatementsIn(text: string): { allergen: string; polarity: "free" | "present"; said: string }[] {
  const out: { allergen: string; polarity: "free" | "present"; said: string }[] = [];
  const seen = new Set<number>();
  for (const re of FREE_RES) {
    for (const m of text.matchAll(re)) {
      const code = allergenCode(m[1]);
      if (!code || seen.has(m.index!)) continue;
      seen.add(m.index!);
      out.push({ allergen: code, polarity: "free", said: m[0] });
    }
  }
  for (const re of PRESENT_RES) {
    for (const m of text.matchAll(re)) {
      const code = allergenCode(m[1]);
      if (!code || /(?<![\p{L}\p{N}])(?:no|not|ei|inte|ingen)\s*$/iu.test(m[0].slice(0, m[0].length - m[1].length))) continue;
      if (/(?<![\p{L}\p{N}])(?:does not|doesn't|do not|don't|not|ei|inte)\s+$/iu.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
      out.push({ allergen: code, polarity: "present", said: m[0] });
    }
  }
  return out;
}

/** A sentence that says the data is silent or uncertain claims nothing: it is never judged for claims or allergens. */
const HEDGE = /(?<![\p{L}\p{N}])(?:does not say|doesn't say|do not say|no data|not in the data|unknown|not known|cannot confirm|can't confirm|could not confirm|not stated|not declared|no allergen data|check the label|ask the|ei tietoa|ei kerro|tuntematon|okänd|framgår inte|inga uppgifter|uncertain|not sure)(?![\p{L}\p{N}])/iu;
/** Words that make an allergen sentence about a rule ("the mandate forbids nuts"), not about a product. */
const RULE_WORDS = /(?<![\p{L}\p{N}])(?:rule|rules|mandate|forbid\p{L}*|not allowed|must not|may not|never offer|won't offer|excluded|policy|requires?|required|kielletty|kielt\p{L}*|sääntö\p{L}*|förbjud\p{L}*|regel\p{L}*|tillåt\p{L}*)(?![\p{L}\p{N}])/iu;

function checkSafety(text: string, facts: Facts): Violation[] {
  if (HEDGE.test(text)) return [];
  const out: Violation[] = [];
  const freeBacked = (a: string) => facts.allergensFree.has(a) || (a === "nuts" && facts.allergensFree.has("peanuts") && facts.allergensFree.has("nuts")) || (RULE_WORDS.test(text) && facts.allergensRuled.has(a));
  for (const c of claimsIn(text)) {
    if (c.negated) continue;
    const allergen = CLAIM_ALLERGEN[c.claim];
    const backed = facts.claims.has(c.claim) || (c.claim === "lactose_free" && facts.claims.has("milk_free")) || (allergen !== undefined && freeBacked(allergen)) || (RULE_WORDS.test(text) && facts.text.includes(c.claim));
    if (!backed) out.push({ kind: "claim", said: c.said });
  }
  const claimed = new Set(claimsIn(text).map((c) => CLAIM_ALLERGEN[c.claim]).filter(Boolean));
  for (const a of allergenStatementsIn(text)) {
    if (a.polarity === "free" && claimed.has(a.allergen) && /(?:free|safe)$/iu.test(a.said)) continue; // "gluten-free": judged as the claim
    const asClaim = Object.entries(CLAIM_ALLERGEN).find(([, x]) => x === a.allergen)?.[0] as Claim | undefined;
    const backed = a.polarity === "free" ? freeBacked(a.allergen) || (asClaim !== undefined && facts.claims.has(asClaim)) : facts.allergensPresent.has(a.allergen) || (RULE_WORDS.test(text) && facts.allergensRuled.has(a.allergen));
    if (!backed) out.push({ kind: "allergen", said: a.said });
  }
  return out;
}

// ---------- written text: replace what the data does not back ----------

export const DATA_DOES_NOT_SAY = "The data does not say.";

export type Grounded = { text: string; violations: Violation[]; sentences: number; replaced: number };

/** Sentences, keeping what separates them, so the text can be put back together unchanged where it is fine. */
export function sentencesOf(text: string): { sentence: string; sep: string }[] {
  const out: { sentence: string; sep: string }[] = [];
  const re = /(?<=[.!?…])\s+(?=[\p{Lu}\d"“(€])|\n+/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push({ sentence: text.slice(last, m.index!), sep: m[0] });
    last = m.index! + m[0].length;
  }
  out.push({ sentence: text.slice(last), sep: "" });
  return out.filter((s) => s.sentence.trim() || s.sep);
}

/**
 * Model text made safe to show: every sentence that names a product, price, amount, date, claim or allergen the
 * facts do not back is replaced by `replacement` ("The data does not say."); repeated replacements collapse into one.
 */
export function groundText(text: string, facts: Facts, opts: CheckOptions & { replacement?: string } = {}): Grounded {
  const replacement = opts.replacement ?? DATA_DOES_NOT_SAY;
  const parts = sentencesOf(text);
  const violations: Violation[] = [];
  let replaced = 0;
  let out = "";
  let lastWasReplacement = false;
  for (const { sentence, sep } of parts) {
    const v = sentence.trim() ? checkText(sentence, facts, { ...opts, final: true }) : [];
    if (v.length) {
      violations.push(...v);
      replaced += 1;
      if (!lastWasReplacement) {
        const lead = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?/.exec(sentence)?.[0] ?? "";
        out += `${lead}${replacement}${sep}`;
      } else if (sep.includes("\n")) out = out.replace(/\s*$/, sep);
      lastWasReplacement = true;
    } else {
      out += sentence + sep;
      lastWasReplacement = false;
    }
  }
  return { text: replaced ? out.trimEnd() : text, violations: dedupe(violations), sentences: parts.length, replaced };
}

/** The same for a short field (a reason, a dish's method): the whole field is replaced when anything in it is not backed. */
export function groundField(text: string, facts: Facts, opts: CheckOptions & { replacement?: string } = {}): Grounded {
  const v = checkText(text, facts, { ...opts, final: true });
  return v.length ? { text: opts.replacement ?? DATA_DOES_NOT_SAY, violations: v, sentences: 1, replaced: 1 } : { text, violations: [], sentences: 1, replaced: 0 };
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

// ---------- what a person's own words say (for structured output read from them) ----------

/** Every allergen a text names in any way ("no nuts", "pähkinätön", "peanut allergy"), as the data's codes. */
export function allergensMentioned(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase().replace(/_/g, " ");
  for (const [code, re] of ALLERGEN_WORDS) if (new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})`, "iu").test(t)) out.add(code);
  for (const c of claimsIn(t)) {
    const a = CLAIM_ALLERGEN[c.claim];
    if (a) out.add(a);
  }
  if (out.has("nuts")) out.add("peanuts").add("nuts");
  return out;
}

const DAY_WORDS = new RegExp(
  [
    ...WEEKDAYS.flat().map((w) => w.slice(0, Math.max(3, w.length - 3))),
    ...MONTHS.flat().map((m) => m.slice(0, Math.max(3, m.length - 2))),
    "today", "tonight", "tomorrow", "week", "weekend", "day", "days", "date", "morning", "evening", "asap",
    "tänään", "huomen", "ylihuomen", "viiko", "päiv", "aamu", "illa", "idag", "imorgon", "i morgon", "övermorgon", "veck", "dag", "helg",
  ]
    .map((w) => `(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    .join("|") + "|\\d{4}-\\d{2}-\\d{2}|(?<!\\d)\\d{1,2}\\.\\d{1,2}\\.?",
  "iu",
);

/** True when a text says anything about when: a weekday, a date, "tomorrow", "next week", in the three languages. */
export function mentionsDay(text: string): boolean {
  return DAY_WORDS.test(text) || RELATIVE_DAYS.some(([re]) => re.test(text.toLowerCase())) || WRITTEN_DAY.test(text.toLowerCase());
}

// ---------- the day a person's words name ----------

/** Weekday stems that match every inflection: "maanantaiksi", "tiistaina", "på måndag", "i fredags", "Monday's". */
const WEEKDAY_STEMS: RegExp[] = [
  /(?<![\p{L}])(monday|mon\b|maanant|måndag|mandag)/iu,
  /(?<![\p{L}])(tuesday|tue\b|tues\b|tiistai|tisdag)/iu,
  /(?<![\p{L}])(wednesday|wed\b|keskiviik|onsdag)/iu,
  /(?<![\p{L}])(thursday|thu\b|thur\b|thurs\b|torstai|torsdag)/iu,
  /(?<![\p{L}])(friday|fri\b|perjanta|fredag)/iu,
  /(?<![\p{L}])(saturday|sat\b|lauanta|lördag|lordag)/iu,
  /(?<![\p{L}])(sunday|sun\b|sunnunta|söndag|sondag)/iu,
];
/** Days from today: "the day after tomorrow" first, because it also says "tomorrow". */
const RELATIVE_DAYS: [RegExp, number][] = [
  [/day after tomorrow|(?<![\p{L}])ylihuom|(?<![\p{L}])(i\s*)?övermorgon|(?<![\p{L}])overmorgon/iu, 2],
  [/(?<![\p{L}])(tomorrow|huomen|huomis|i\s*morgon|imorgon)/iu, 1],
  [/(?<![\p{L}])(today|tonight|tänään|tanaan|idag|i\s*dag|i\s*kväll)/iu, 0],
];
/** Said without a day: any day in the coming three weeks fits ("next week", "for the weekend", "asap"). */
const VAGUE_DAYS = /(?<![\p{L}])(next week|this week|weekend|asap|as soon as|ensi viiko|tällä viiko|viikonlop|mahdollisimman pian|pikaisesti|nästa vecka|denna vecka|i helgen|helgen|snarast|så snart)/iu;
/** Before or by a day: the day before it fits too ("before Tuesday" is a Monday). */
const BEFORE = /(?<![\p{L}])(before|ennen|före|innan|viimeistään)(?![\p{L}])/iu;
/** A day of the month written out: "16.11.", "16/11", "den 19:e", "the 20th", "20. päiväksi", "20 November", "November 20", "20. marraskuuta". */
const WRITTEN_DAY = /(?<!\d)(\d{1,2})\s*[./]\s*(\d{1,2})(?!\d)|(?<!\d)(\d{1,2})(?::e|:a|st|nd|rd|th)(?![\p{L}])|(?<!\d)(\d{1,2})\.\s*(?:päivä|pv|p\.|dag)|(?<![\p{L}])den\s+(\d{1,2})(?!\d)/iu;

const addDaysTo = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The days a person's words name, from `today` (Helsinki, YYYY-MM-DD): each weekday named (the next one and the one a
 * week later: "ensi maanantaiksi"), "tomorrow" and its kin, and each day of the month written out (any month when the
 * words give none). `vague`: the words speak of when without a day ("next week").
 */
export function daysNamed(text: string, today: string): { days: Set<string>; dayOfMonth: Map<number, number | undefined>; vague: boolean } {
  const t = text.toLowerCase().normalize("NFC");
  const days = new Set<string>();
  WEEKDAY_STEMS.forEach((re, i) => {
    if (!re.test(t)) return;
    const ahead = (i + 1 - weekdayOf(today) + 7) % 7 || 7;
    days.add(addDaysTo(today, ahead));
    days.add(addDaysTo(today, ahead + 7));
  });
  for (const [re, n] of RELATIVE_DAYS) {
    if (re.test(t)) {
      days.add(addDaysTo(today, n));
      break;
    }
  }
  const dayOfMonth = new Map<number, number | undefined>();
  for (const m of t.matchAll(new RegExp(WRITTEN_DAY.source, "giu"))) {
    const day = Number(m[1] ?? m[3] ?? m[4] ?? m[5]);
    const month = m[2] ? Number(m[2]) : undefined;
    if (day >= 1 && day <= 31 && (!month || (month >= 1 && month <= 12))) dayOfMonth.set(day, month);
  }
  MONTHS.forEach((names, mi) => {
    for (const name of names) {
      const stem = name.slice(0, Math.max(3, name.length - 2));
      for (const m of t.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s*(?:of\\s+)?${stem}|${stem}[\\p{L}]*\\s+(\\d{1,2})(?!\\d)`, "giu"))) {
        const day = Number(m[1] ?? m[2]);
        if (day >= 1 && day <= 31) dayOfMonth.set(day, mi + 1);
      }
    }
  });
  return { days, dayOfMonth, vague: VAGUE_DAYS.test(t) };
}

/**
 * Do the words state this delivery day? It must be a day they name (above), the day before one when they say
 * "before", or, when they speak of when only vaguely, a day in the coming three weeks. A day they do not contain is
 * not stated. Without `today`, only that the words say anything about when (the older, looser check).
 */
export function dayStated(text: string, iso: string, today?: string): boolean {
  if (!today) return mentionsDay(text);
  const n = daysNamed(text, today);
  if (n.days.has(iso)) return true;
  const [, m, d] = iso.split("-").map(Number);
  const written = n.dayOfMonth.get(d);
  if (n.dayOfMonth.has(d) && (written === undefined || written === m)) return true;
  if (BEFORE.test(text) && n.days.has(addDaysTo(iso, 1))) return true;
  if (n.vague && iso >= today && iso <= addDaysTo(today, 21)) return true;
  return false;
}
