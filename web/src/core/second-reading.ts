import { facetsOf, fold, tokenize } from "./catalog/search";
import type { Concern, Correction } from "./concerns";
import { formatAmount, type NeedPatch, type NeedUnit } from "./need";
import { isMaterialAttribute, normaliseAllergen, normaliseWantedTag } from "./vocabulary";

/**
 * The second reading. Every request a model reads into a structured need is read a second time, in parallel, by an
 * independent model of another family (NVIDIA Nemotron, open weights). This module compares the two readings, as
 * plain code, on the fields that change the order, and turns a material difference into one precise question for
 * the buyer, showing both readings, before any price is fixed.
 *
 * The second reading can only add a question. It never changes the need (the buyer does, by choosing), never picks a
 * product and never approves anything. No model is called here: server/agent/second-reader.ts makes the call and
 * hands over its need.
 *
 * What counts as material (tuned on the evaluation in web/eval/second-reader/, numbers in web/docs/second-reader.md):
 *   amount     the amounts differ by READING_RULES.amountFactor (2x) or more, or one reads packs and the other
 *              litres or kilos and no pack size written in the text reconciles them ("100 x 10 l" = 100 packs = 1,000 L)
 *   claims     a dietary claim the words name (lactose-free, organic, vegan, ...) that the second reading requires and
 *              the first does not, or that one reading requires and the other excludes ("not lactose-free")
 *   allergens  an allergen the words name that the second reading avoids and the first does not ("no gluten" counts
 *              the same as gluten-free)
 *   kind       a different kind of product: the item words share no word stem, or name a different kind (coffee
 *              milk, cream), or two different product codes
 *   date       two different delivery days, or a day only the second reading has, when the words name a day and the
 *              second reading's day fits them (the weekday named, "tomorrow")
 * Not material: anything the words do not name (a claim, an allergen or a day one reading invented: the grounding
 * check's business), the wording of the item, optimise goals, a field the second reading left empty, a claim one
 * reading excludes and the other leaves unsaid, "by" against "on" the same day, fat content and other attributes.
 */

export type ReadField = "amount" | "claims" | "allergens" | "kind" | "date";
export const READ_FIELDS: readonly ReadField[] = ["amount", "claims", "allergens", "kind", "date"];

export type ReadingDifference = {
  field: ReadField;
  /** The first reading's value for the field, in words ("1,000 L", "lactose-free", "not stated"). */
  first: string;
  second: string;
  /** Why it is material, in a few words ("10x the amount", "packs against litres", "negated"). */
  why: string;
  /** The change that takes the second reading for this field. Absent when it cannot be written as a patch. */
  patch?: NeedPatch;
};

export type ReadingComparison = { agreed: boolean; differences: ReadingDifference[]; /** Differences found but not material, for the ledger. */ minor: string[] };

/** The part of a need the comparison reads. A second reading that came back incomplete still has these. */
export type Reading = {
  item: { text: string; attributes: string[]; excludedAttributes: string[]; productId?: string };
  quantity?: { amount: number; unit: NeedUnit };
  /** One pack's size, when the words give it ("100 x 10 l"): reconciles a count of packs with litres or kilos. */
  packSize?: { amount: number; unit: "L" | "kg" | "pcs" };
  deliverBy?: string;
  deliverOn?: string;
  requiredClaims: string[];
  forbiddenAllergens: string[];
  sameAsLastTime: boolean;
};

export type ReadingRules = {
  /** Amounts this many times apart (either way) are a material difference. */
  amountFactor: number;
  /** The first reading has a date and the second none: material? (Off: a weaker reader misses dates more often than the first invents them.) */
  askWhenOnlyFirstHasDate: boolean;
  /** The second reading has a date and the first none: material? (The first may have missed "for tomorrow".) */
  askWhenOnlySecondHasDate: boolean;
  /** The second reading has a claim or allergen the first does not: material? */
  askWhenOnlySecondHasClaim: boolean;
  /**
   * The first reading has a claim or allergen the second does not: material? (Off: the second reader missed it, or
   * the first invented it, and an invented claim is the grounding check's to remove; asking cost questions and caught
   * nothing on the evaluation.)
   */
  askWhenOnlyFirstHasClaim: boolean;
  /** One reading excludes a claim ("not lactose-free") and the other says nothing of it: material? (Neither requires it.) */
  askExcludedAgainstUnstated: boolean;
  /** Compare the kind of product at all. */
  compareKind: boolean;
  /** Compare fat content (two different fat contents stated). Not a dietary or allergen claim. */
  compareFat: boolean;
  /**
   * A difference counts only on something the buyer's words say: a claim or allergen the text names, a day when the
   * text names one, and not a day that contradicts the weekday the text names. A reading that adds what nobody said
   * is the grounding check's business, not a question for the buyer.
   */
  onlyWhatTheWordsSay: boolean;
};

/** The rules the product runs with. The evaluation script sweeps them; see web/docs/second-reader.md for why these. */
export const READING_RULES: ReadingRules = {
  amountFactor: 2,
  askWhenOnlyFirstHasDate: false,
  askWhenOnlySecondHasDate: true,
  askWhenOnlySecondHasClaim: true,
  askWhenOnlyFirstHasClaim: false,
  askExcludedAgainstUnstated: false,
  compareKind: true,
  compareFat: false,
  onlyWhatTheWordsSay: true,
};

// ---------- what the buyer's words say ----------

/** Words (folded: no accents, ä as a) that name a claim or an allergen, in English, Finnish and Swedish. */
const CLAIM_WORDS: Record<string, RegExp> = {
  lactose_free: /lact|lakto|laktos|hyla/,
  low_lactose: /lact|lakto|laktos|hyla/,
  organic: /organic|luomu|ekolog|\bbio\b|\beko\b/,
  vegan: /vegan|vegaan|plant[ -]?based|kasvipohj|vaxtbas/,
  vegetarian: /vegetar|kasvis/,
};
const ALLERGEN_WORDS: Record<string, RegExp> = {
  gluten: /glut/,
  eggs: /\beggs?\b|egg[ -]?free|kananmun|munaton|munat|\bagg/,
  nuts: /\bnuts?\b|nut[ -]?free|(?<!maa)pahkin|(?<!jord)notter|(?<!jord)notfri/,
  peanuts: /peanut|maapahkin|jordnot/,
  soy: /\bsoy|soija|\bsoja/,
  milk: /dairy|maidoton|maidottom|mjolkfri|milk[ -]?free|no milk|without milk|ilman maitoa|utan mjolk|milk allerg|maitoallerg|mjolkallerg/,
  wheat: /wheat|vehna|\bvete/,
  fish: /\bfish|\bkala|\bfisk/,
  crustaceans: /shellfish|crustacean|ayriai|skaldjur/,
  molluscs: /mollus|nilvi|blotdjur/,
  sesame: /sesam|seesam/,
  mustard: /mustard|sinap|senap/,
  celery: /celery|selleri/,
  lupin: /lupin|lupiini/,
  sulphites: /sulph|sulfi|sulfit/,
  oats: /\boats?\b|kaura|havre/,
};
const WEEKDAY_WORDS: RegExp[] = [
  /monday|maanantai|mandag/,
  /tuesday|tiistai|tisdag/,
  /wednesday|keskiviik|onsdag/,
  /thursday|torstai|torsdag/,
  /friday|perjantai|fredag/,
  /saturday|lauantai|lordag/,
  /sunday|sunnuntai|sondag/,
];
const DAY_WORDS = /today|tonight|tomorrow|tanaan|huome|ylihuome|idag|i ?morgon|overmorgon|week|viiko|vecka|\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}(st|nd|rd|th|:e)\b|\d{1,2}\.\s*(paiva|pv)|\bden \d{1,2}/;

/** Does the text name this claim (in any polarity)? A tag with no word list counts as named, so it is still compared. */
export function claimNamed(text: string, tag: string): boolean {
  const re = CLAIM_WORDS[tag];
  return !re || re.test(fold(text));
}

export function allergenNamed(text: string, allergen: string): boolean {
  const re = ALLERGEN_WORDS[allergen];
  return !re || re.test(fold(text));
}

/** Does the text name a delivery day at all? */
export function dayNamed(text: string): boolean {
  const t = fold(text);
  return DAY_WORDS.test(t) || WEEKDAY_WORDS.some((re) => re.test(t));
}

/** The ISO weekday the text names, when it names exactly one. */
export function weekdayNamed(text: string): number | undefined {
  const t = fold(text);
  const hits = WEEKDAY_WORDS.map((re, i) => (re.test(t) ? i + 1 : 0)).filter(Boolean);
  return hits.length === 1 ? hits[0] : undefined;
}

const RELATIVE_WORDS: [RegExp, number][] = [
  [/day after tomorrow|ylihuom|overmorgon/, 2],
  [/tomorrow|huomen|huomis|i ?morgon/, 1],
  [/\btoday\b|tanaan|\bidag\b/, 0],
];

/**
 * Does a day fit what the words say? A named weekday must be that weekday; "tomorrow", "ylihuomenna" or "idag" (with no
 * weekday or date written) must be that day from `today`. Words that pin nothing ("next week", a written date) fit any day.
 */
export function dayFitsWords(text: string, day: string, today?: string): boolean {
  const named = weekdayNamed(text);
  if (named) return weekdayOf(day) === named;
  const t = fold(text);
  if (today && !/\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}(st|nd|rd|th|:e)\b/.test(t)) {
    // "day after tomorrow" also contains "tomorrow": the first pattern that matches wins.
    for (const [re, plus] of RELATIVE_WORDS) if (re.test(t)) return day === addDays(today, plus);
  }
  return true;
}

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() || 7;

// ---------- reading the fields ----------

/** A claim that means "free from an allergen" is compared as that allergen: "gluten-free" and "no gluten" agree. */
const CLAIM_AS_ALLERGEN: Record<string, string> = { gluten_free: "gluten", egg_free: "eggs", soy_free: "soy", wheat_free: "wheat", milk_free: "milk", nut_free: "nuts" };
const isFat = (t: string) => t === "fat_free" || /^fat_\d+(_\d+)?$/.test(t);

type Claims = { wanted: Set<string>; excluded: Set<string>; fat: Set<string>; avoid: Set<string> };

/** A reading's dietary claims (wanted and excluded), fat content and allergens to avoid, in the catalogue's words. */
export function readingFacts(r: Reading): { wanted: string[]; excluded: string[]; fat: string[]; avoid: string[] } {
  const c = claimsOf(r);
  return { wanted: [...c.wanted].sort(), excluded: [...c.excluded].sort(), fat: [...c.fat].sort(), avoid: [...c.avoid].sort() };
}

function claimsOf(r: Reading): Claims {
  const wanted = new Set<string>();
  const excluded = new Set<string>();
  const fat = new Set<string>();
  const avoid = new Set(r.forbiddenAllergens.map(normaliseAllergen));
  for (const tag of [...r.requiredClaims, ...r.item.attributes]) {
    const t = normaliseWantedTag(tag);
    if (t.kind === "forbid_allergen") avoid.add(t.value);
    else if (t.kind === "claim" && CLAIM_AS_ALLERGEN[t.value]) avoid.add(CLAIM_AS_ALLERGEN[t.value]);
    else if (t.kind === "claim" && isFat(t.value)) fat.add(t.value);
    else if (t.kind === "claim" && isMaterialAttribute(t.value)) wanted.add(t.value);
  }
  for (const tag of r.item.excludedAttributes) {
    const t = normaliseWantedTag(tag);
    if (t.kind === "claim" && isMaterialAttribute(t.value) && !isFat(t.value)) excluded.add(t.value);
  }
  for (const x of excluded) wanted.delete(x);
  return { wanted, excluded, fat, avoid };
}

const words = (tag: string) => tag.replace(/_/g, "-").replace(/^fat-(\d+)-(\d+)$/, "$1.$2 % fat").replace(/^fat-(\d+)$/, "$1 % fat");
const NOT_STATED = "not stated";

function claimState(c: Claims, tag: string): "wanted" | "excluded" | "unstated" {
  return c.wanted.has(tag) ? "wanted" : c.excluded.has(tag) ? "excluded" : "unstated";
}
const stateWords = (s: "wanted" | "excluded" | "unstated", tag: string) => (s === "wanted" ? words(tag) : s === "excluded" ? `not ${words(tag)}` : NOT_STATED);

/** Every number written in the text, read both ways where the separator is ambiguous ("1.000" is 1000 and 1). */
export function numbersInText(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d+(?:[  .,]\d+)*/g)) {
    const raw = m[0].trim();
    const plain = Number(raw.replace(/[  .,]/g, ""));
    if (Number.isFinite(plain)) out.add(plain);
    const decimal = Number(raw.replace(/[  ]/g, "").replace(",", "."));
    if (Number.isFinite(decimal)) out.add(decimal);
    for (const part of raw.split(/[  ]+|\s*[x×*]\s*/)) {
      const n = Number(part.replace(",", "."));
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return [...out].filter((n) => n > 0);
}

const isCount = (u: NeedUnit) => u === "pack" || u === "pcs";
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function compareAmount(a: Reading, b: Reading, text: string, rules: ReadingRules, minor: string[]): ReadingDifference | undefined {
  const qa = a.quantity;
  const qb = b.quantity;
  const show = (q: Reading["quantity"], r: Reading) => (q ? formatAmount(q.amount, q.unit) : r.sameAsLastTime ? "same as last time" : NOT_STATED);
  if (!qa && !qb) return undefined;
  if (qa && !qb) {
    minor.push(`the second reading has no amount (${b.sameAsLastTime ? "same as last time" : "not read"})`);
    return undefined;
  }
  if (!qa && qb) return { field: "amount", first: show(qa, a), second: show(qb, b), why: "only the second reading has an amount", patch: { quantity: { ...qb } } };
  const x = qa!;
  const y = qb!;
  const diff = (why: string): ReadingDifference => ({ field: "amount", first: show(x, a), second: show(y, b), why, patch: { quantity: { ...y } } });
  const ratio = Math.max(x.amount, y.amount) / Math.min(x.amount, y.amount);
  if (x.unit === y.unit || (isCount(x.unit) && isCount(y.unit))) {
    if (ratio >= rules.amountFactor - 1e-9) return diff(`${ratio >= 9.5 && ratio <= 10.5 ? "10x" : `${Math.round(ratio * 10) / 10}x`} the amount`);
    if (!close(x.amount, y.amount)) minor.push(`amounts ${show(x, a)} and ${show(y, b)} are close`);
    if (x.unit !== y.unit) minor.push(`${x.unit} and ${y.unit} both count packs`);
    return undefined;
  }
  if (isCount(x.unit) !== isCount(y.unit)) {
    // Packs against litres or kilos: the same order only when a pack size written in the text reconciles them.
    const [count, base] = isCount(x.unit) ? [x.amount, y.amount] : [y.amount, x.amount];
    const sizes = [...numbersInText(text), ...[a.packSize?.amount, b.packSize?.amount].filter((n): n is number => !!n)];
    // A count equal to the litres, from a reading that also wrote a pack size, is that reading writing the total.
    const wroteTotal = close(count, base) && !!(isCount(x.unit) ? a.packSize : b.packSize);
    if (wroteTotal || sizes.some((k) => close(count * k, base))) {
      minor.push(`${show(x, a)} and ${show(y, b)} are the same order (a pack size in the text)`);
      return undefined;
    }
    return diff(`${isCount(x.unit) ? "packs" : x.unit} against ${isCount(y.unit) ? "packs" : y.unit}`);
  }
  // Litres against kilos.
  if (ratio >= rules.amountFactor - 1e-9) return diff(`${x.unit} against ${y.unit}, and a different amount`);
  minor.push(`${show(x, a)} against ${show(y, b)}: the unit differs, the amount does not`);
  return undefined;
}

function compareClaims(a: Reading, b: Reading, text: string, rules: ReadingRules, minor: string[]): ReadingDifference | undefined {
  const ca = claimsOf(a);
  const cb = claimsOf(b);
  const tags = [...new Set([...ca.wanted, ...ca.excluded, ...cb.wanted, ...cb.excluded])].sort();
  const firstWords: string[] = [];
  const secondWords: string[] = [];
  const whys: string[] = [];
  for (const t of tags) {
    const sa = claimState(ca, t);
    const sb = claimState(cb, t);
    if (sa === sb) continue;
    if (rules.onlyWhatTheWordsSay && text && !claimNamed(text, t)) {
      minor.push(`${words(t)} in one reading, but the words do not name it`);
      continue;
    }
    if (!rules.askExcludedAgainstUnstated && sa !== "wanted" && sb !== "wanted") {
      minor.push(`${words(t)}: ${stateWords(sa, t)} against ${stateWords(sb, t)}, and neither requires it`);
      continue;
    }
    if (sb === "unstated" && !rules.askWhenOnlyFirstHasClaim) continue;
    if (sa === "unstated" && !rules.askWhenOnlySecondHasClaim) continue;
    firstWords.push(stateWords(sa, t));
    secondWords.push(stateWords(sb, t));
    whys.push(sa !== "unstated" && sb !== "unstated" ? `${words(t)} negated in one reading` : `${words(t)} in one reading only`);
  }
  // Fat content: material only when both readings state one and they differ.
  if (rules.compareFat && ca.fat.size && cb.fat.size && [...ca.fat].sort().join() !== [...cb.fat].sort().join()) {
    firstWords.push([...ca.fat].map(words).join(", "));
    secondWords.push([...cb.fat].map(words).join(", "));
    whys.push("a different fat content");
  }
  if (!whys.length) return undefined;
  return { field: "claims", first: firstWords.join("; "), second: secondWords.join("; "), why: whys.join("; "), patch: claimsPatch(a, b) };
}

/** The first reading's claims with the second reading's wanted and excluded claims (and fat content) in their place. */
function claimsPatch(a: Reading, b: Reading): NeedPatch {
  const material = (t: string) => {
    const n = normaliseWantedTag(t);
    return n.kind === "claim" && isMaterialAttribute(n.value) && !CLAIM_AS_ALLERGEN[n.value];
  };
  const keep = (xs: string[]) => xs.filter((t) => !material(t));
  const attributes = [...new Set([...keep(a.item.attributes), ...b.item.attributes.filter(material), ...b.requiredClaims.filter(material)])];
  const excludedAttributes = [...new Set([...keep(a.item.excludedAttributes), ...b.item.excludedAttributes.filter(material)])].filter((t) => !attributes.includes(t));
  return { item: { attributes, excludedAttributes }, requiredClaims: keep(a.requiredClaims) };
}

function compareAllergens(a: Reading, b: Reading, text: string, rules: ReadingRules, minor: string[]): ReadingDifference | undefined {
  const xa = claimsOf(a).avoid;
  const xb = claimsOf(b).avoid;
  const named = (x: string) => {
    if (!rules.onlyWhatTheWordsSay || !text || allergenNamed(text, x)) return true;
    minor.push(`${x} avoided in one reading, but the words do not name it`);
    return false;
  };
  const onlyA = [...xa].filter((x) => !xb.has(x) && named(x)).sort();
  const onlyB = [...xb].filter((x) => !xa.has(x) && named(x)).sort();
  if (!rules.askWhenOnlyFirstHasClaim) onlyA.length = 0;
  if (!rules.askWhenOnlySecondHasClaim) onlyB.length = 0;
  if (!onlyA.length && !onlyB.length) return undefined;
  const list = (s: Set<string>) => ([...s].length ? `no ${[...s].sort().join(", ")}` : NOT_STATED);
  // The patch writes the second reading's allergens as forbidden allergens, and drops the "free from" claims that
  // stood for the first reading's.
  const claimFree = (t: string) => {
    const n = normaliseWantedTag(t);
    return n.kind === "forbid_allergen" || (n.kind === "claim" && !!CLAIM_AS_ALLERGEN[n.value]);
  };
  return {
    field: "allergens",
    first: list(xa),
    second: list(xb),
    why: [...onlyA.map((x) => `${x} avoided in the first reading only`), ...onlyB.map((x) => `${x} avoided in the second reading only`)].join("; "),
    patch: { forbiddenAllergens: [...xb].sort(), requiredClaims: a.requiredClaims.filter((t) => !claimFree(t)), item: { attributes: a.item.attributes.filter((t) => !claimFree(t)) } },
  };
}

/** Words that say a claim, an amount or a container rather than what the product is. */
const NOT_KIND = /^(lactose|lactos|laktoos|laktos|gluten|gluteen|luomu|organic|ekolog|vegan|vegaan|free|fri|ton|ttoma|semi|skim|whole|kevyt|rasvaton|tays|mellan|latt|litr|liter|kilo|pack|case|box|laatik|karton|carton|kartong|bag|pussi|piece|kpl|pcs|stk|ordinary|regular|tavall|vanlig|normal|fresh|tuore|farsk|our|the|and|for|med|och|ja|with)/;

function kindWords(text: string): string[] {
  return tokenize(text).filter((w) => w.length >= 4 && !/^\d/.test(w) && !NOT_KIND.test(w));
}

function sameStem(x: string, y: string): boolean {
  if (x.includes(y) || y.includes(x)) return true;
  const n = Math.min(x.length, y.length, 5);
  return n >= 4 && x.slice(0, n) === y.slice(0, n);
}

function compareKind(a: Reading, b: Reading): ReadingDifference | undefined {
  const pa = a.item.productId?.trim();
  const pb = b.item.productId?.trim();
  if (pa && pb && pa !== pb) return { field: "kind", first: `product ${pa}`, second: `product ${pb}`, why: "two different product codes" };
  const ta = a.item.text.trim();
  const tb = b.item.text.trim();
  if (!ta || !tb || fold(ta) === fold(tb)) return undefined;
  const fa = facetsOf(ta);
  const fb = facetsOf(tb);
  const facetDiff = [...fa.filter((f) => !fb.includes(f)), ...fb.filter((f) => !fa.includes(f))];
  if (facetDiff.length) return { field: "kind", first: ta, second: tb, why: `a different kind of product (${facetDiff.join(", ")})` };
  const wa = kindWords(ta);
  const wb = kindWords(tb);
  if (!wa.length || !wb.length) return undefined;
  if (wa.some((x) => wb.some((y) => sameStem(x, y)))) return undefined;
  return { field: "kind", first: ta, second: tb, why: "the item words share nothing" };
}

function compareDate(a: Reading, b: Reading, text: string, today: string | undefined, rules: ReadingRules, minor: string[]): ReadingDifference | undefined {
  const da = a.deliverOn ?? a.deliverBy;
  const db = b.deliverOn ?? b.deliverBy;
  if (da === db) {
    if (da && !!a.deliverOn !== !!b.deliverOn) minor.push(`"by" against "on" ${da}`);
    return undefined;
  }
  if (rules.onlyWhatTheWordsSay && text) {
    if (!dayNamed(text)) {
      minor.push(`a delivery day in one reading (${da ?? db}), but the words name none`);
      return undefined;
    }
    // A second reading on a day the words rule out (another weekday than the one named, not "tomorrow") misread
    // them; that is no question for the buyer. (The first reading may rightly differ from the words: "before
    // Wednesday" is a Tuesday.)
    if (db && !dayFitsWords(text, db, today)) {
      minor.push(`the second reading's day ${db} does not fit the words`);
      return undefined;
    }
  }
  if (da && !db) {
    if (!rules.askWhenOnlyFirstHasDate) {
      minor.push("the second reading has no delivery day");
      return undefined;
    }
    return { field: "date", first: da, second: NOT_STATED, why: "only the first reading has a delivery day", patch: { deliverBy: null } };
  }
  if (!da && db) {
    if (!rules.askWhenOnlySecondHasDate) {
      minor.push(`only the second reading has a delivery day (${db})`);
      return undefined;
    }
    return { field: "date", first: NOT_STATED, second: db, why: "only the second reading has a delivery day", patch: { deliverBy: db } };
  }
  return { field: "date", first: da!, second: db!, why: "two different delivery days", patch: { deliverBy: db! } };
}

/**
 * Compare two readings of the same words. `first` is the reading the order goes on; `second` is the independent one.
 * `text`: the buyer's words: pack sizes written in them, and what they name (READING_RULES.onlyWhatTheWordsSay). Without
 * a text every difference is compared.
 */
export function compareReadings(first: Reading, second: Reading, opts: { text?: string; /** Today in Helsinki, for "tomorrow". */ today?: string; rules?: Partial<ReadingRules> } = {}): ReadingComparison {
  const rules = { ...READING_RULES, ...opts.rules };
  const minor: string[] = [];
  const differences = [
    compareAmount(first, second, opts.text ?? "", rules, minor),
    compareClaims(first, second, opts.text ?? "", rules, minor),
    compareAllergens(first, second, opts.text ?? "", rules, minor),
    rules.compareKind ? compareKind(first, second) : undefined,
    compareDate(first, second, opts.text ?? "", opts.today, rules, minor),
  ].filter((d): d is ReadingDifference => !!d);
  return { agreed: differences.length === 0, differences, minor };
}

// ---------- the record and the question ----------

export type SecondReadingStatus = "agreed" | "differed" | "unavailable";

/** Why the second reader gave nothing to compare. */
export type UnavailableReason = "timeout" | "at_capacity" | "failed" | "unreadable" | "over_limit" | "not_a_purchase" | "not_configured";

/** What the intake keeps of the two readings: shown in the lane, written to the ledger, counted on the safeguards page. */
export type SecondReadingRecord = {
  status: SecondReadingStatus;
  /** provider:model-id of each reader. */
  firstModel: string;
  secondModel: string;
  /** How long the second reader took (absent when it was cut off). */
  secondMs?: number;
  /** How much later than the first reading the second one arrived (0 when it was first): the wait it added. */
  waitedMs?: number;
  reason?: UnavailableReason;
  /** Unavailable: what went wrong, in one line. */
  detail?: string;
  differences: ReadingDifference[];
  minor: string[];
  /** The first reading's value of each compared field when the comparison was made: a question is asked only while the need still has it. */
  firstValues: Record<ReadField, string>;
  at: string;
};

/** A field's value in a need, as compared: a question is only asked while the need still has the first reading's value. */
export function fieldValue(n: Reading, field: ReadField): string {
  const c = claimsOf(n);
  switch (field) {
    case "amount":
      return n.quantity ? `${n.quantity.amount} ${n.quantity.unit}` : n.sameAsLastTime ? "same" : "";
    case "claims":
      return JSON.stringify([[...c.wanted].sort(), [...c.excluded].sort(), [...c.fat].sort()]);
    case "allergens":
      return [...c.avoid].sort().join(",");
    case "kind":
      return `${fold(n.item.text.trim())}|${n.item.productId ?? ""}`;
    case "date":
      return n.deliverOn ?? n.deliverBy ?? "";
  }
}

export function fieldValues(n: Reading): Record<ReadField, string> {
  return Object.fromEntries(READ_FIELDS.map((f) => [f, fieldValue(n, f)])) as Record<ReadField, string>;
}

/** A model id in words, for the buyer: "anthropic:claude-opus-5-5" is Claude Opus 5.5. */
export function readerName(id: string): string {
  const m = id.slice(id.indexOf(":") + 1);
  if (/nemotron-3-nano/i.test(m)) return "NVIDIA Nemotron 3 Nano";
  if (/nemotron-3-super/i.test(m)) return "NVIDIA Nemotron 3 Super";
  if (/nemotron/i.test(m)) return `NVIDIA ${m.split("/").pop()!.replace(/-BF16$|-HF$/i, "").replace(/-/g, " ")}`;
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(m);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return m;
}

const FIELD_WORDS: Record<ReadField, string> = { amount: "the amount", claims: "what the product must be", allergens: "what to avoid", kind: "the product", date: "the delivery day" };

/** What a field is called in the question. */
export function readFieldWords(field: ReadField): string {
  return FIELD_WORDS[field];
}

/**
 * The questions a second reading adds: one per differing field, while the need still holds the first reading's
 * value for it (a correction the buyer already made settles it). Each shows both readings; the buyer picks one or
 * writes the request again. Nothing is chosen for them.
 */
export function readingConcerns(need: Reading, record: SecondReadingRecord | undefined): Concern[] {
  if (!record || record.status !== "differed") return [];
  const now = fieldValues(need);
  return record.differences
    .filter((d) => now[d.field] === record.firstValues[d.field])
    .map((d) => {
      const corrections: Correction[] = [
        { id: "keep_first", label: d.first === NOT_STATED ? "Leave it unstated" : d.first, patch: {} },
        ...(d.patch ? [{ id: "use_second", label: d.second === NOT_STATED ? "Leave it unstated" : d.second, patch: d.patch }] : []),
        { id: "rewrite", label: "Neither: I will write it again", cancel: true as const },
      ];
      return {
        key: `readings_differ:${d.field}:${record.firstValues[d.field]}`,
        code: "readings_differ" as const,
        severity: "warning" as const,
        message: `Two independent readers read ${FIELD_WORDS[d.field]} differently: ${readerName(record.firstModel)} read ${d.first}, ${readerName(record.secondModel)} read ${d.second}. Which did you mean?`,
        confirmable: false,
        corrections,
        evidence: { field: d.field, first: d.first, second: d.second, why: d.why, firstModel: record.firstModel, secondModel: record.secondModel },
      };
    });
}

/** One line for the ledger. */
export function describeSecondReading(r: SecondReadingRecord): string {
  const who = `${readerName(r.firstModel)} and ${readerName(r.secondModel)}`;
  if (r.status === "agreed") return `Read twice, by ${who}: the two readings agree on the amount, the claims, the allergens, the product and the delivery day.`;
  if (r.status === "differed") return `Read twice, by ${who}: they differ on ${r.differences.map((d) => `${FIELD_WORDS[d.field]} (${d.first} against ${d.second})`).join("; ")}. The buyer is asked before any price is fixed.`;
  return `Read once: the second reader (${readerName(r.secondModel)}) was unavailable (${r.reason ?? "failed"}${r.detail ? `: ${r.detail}` : ""}). Dock carried on with the first reading.`;
}
