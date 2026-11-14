import { claimEvidence, wholeIngredients, type ClaimSubject } from "../claim-evidence";
import { natureOf } from "./nature";
import { categoryCodesFor, type IndexedProduct } from "./partner";
import type { Amount, Measure } from "./pack";

/**
 * Product search over the catalogue index: free text in English, Finnish or Swedish plus structured filters.
 * Lexical and deterministic: no LLM, no embeddings. `SearchBackend` is the seam for another engine later.
 */

/** by_nature: no allergen data, but fresh whole produce without this allergen in it (catalog/nature.ts); never a declaration. */
export type AllergenEvidence = "contains" | "may_contain" | "free_from" | "not_declared" | "by_nature" | "unknown";

export type SearchQuery = {
  text?: string;
  ids?: string[];
  /** Partner category code ("10400") or Dock slug ("milk"). */
  category?: string;
  /** Claims every hit must carry (Dock attribute slugs: lactose_free, gluten_free, vegan, organic, ...). */
  requiredClaims?: string[];
  /** Allergens no hit may contain or "may contain". Products without allergen data are excluded (unknown is not safe). */
  forbiddenAllergens?: string[];
  /** "declared" (default): the allergen is not listed although the product has allergen data. "free_from": only explicit statements. */
  allergenProof?: "declared" | "free_from";
  /** Each sales unit must hold at least this much, by a certain pack content. */
  minPackContent?: Amount;
  limit?: number;
};

export type SearchHit = {
  product: IndexedProduct;
  score: number;
  /** Plain-language reasons for the rank, for the ledger and for humans. */
  why: string[];
  /** Evidence for each forbidden allergen. */
  allergens?: Record<string, AllergenEvidence>;
};

export interface SearchBackend {
  search(query: SearchQuery): SearchHit[];
}

// ---------- text normalisation ----------

/** Lower case, accents and Nordic letters folded (ä -> a, ö -> o, å -> a), trademark signs dropped. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[®™©℮]/g, " ");
}

export function tokenize(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// ---------- query understanding ----------

/** Multilingual phrases that mean a dietary claim. Matched on folded text, hyphens as spaces. */
const CLAIM_PHRASES: [string, string[]][] = [
  ["lactose_free", ["lactose free", "lactosefree", "laktoositon", "laktoositonta", "laktoosittomia", "laktoositton", "laktosfri", "laktosfria", "laktosfritt"]],
  ["low_lactose", ["low lactose", "vahalaktoosinen", "vahalaktoosista", "vahalaktoosisia", "laktosreducerad", "laktosfattig", "hyla"]],
  ["gluten_free", ["gluten free", "glutenfree", "gluteeniton", "gluteenitonta", "gluteenittomia", "glutenfri", "glutenfria", "glutenfritt"]],
  ["vegan", ["vegan", "vegaaninen", "vegaanista", "vegaani", "vegansk", "veganska"]],
  ["vegetarian", ["vegetarian", "vegetaarinen", "vegetarisk"]],
  ["organic", ["organic", "luomu", "ekologisk", "ekologiska"]],
  ["egg_free", ["egg free", "munaton", "aggfri"]],
  ["soy_free", ["soy free", "soya free", "soijaton", "sojafri"]],
];
/** Phrases that mean "must not contain". */
const EXCLUSION_PHRASES: [string, string[]][] = [
  ["milk", ["dairy free", "milk free", "maidoton", "mjolkfri"]],
  ["nuts", ["nut free", "pahkinaton", "notfri"]],
  ["eggs", []],
];

const STOPWORDS = new Set(
  (
    "i we need want a an the of for and or with by to in on at some please find buy order get option options " +
    "cheap cheapest best good next week monday tuesday wednesday thursday friday saturday sunday tomorrow today " +
    "litres liters litre liter l kg kilo kilos kilograms g ml dl cl pcs pieces pack packs " +
    "ja tai tarvitsen tarvitaan litraa kiloa kpl maanantaiksi mennessa " +
    "och eller med behover till"
  ).split(" "),
);

export type ParsedQuery = {
  terms: string[];
  claims: string[];
  excludeAllergens: string[];
  /** Small amounts read as a pack size ("10 l"), large ones as the order quantity ("1,000 litres"). */
  packSize?: Amount;
  orderAmount?: Amount;
};

const AMOUNT_RE = /(?<![\d.,])(\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)\s*(litres?|liters?|litraa?|l|dl|cl|ml|kg|kilos?|kiloa|g)(?![a-z])/g;

/**
 * What kitchens call a product and what the wholesaler's names say differ: "oat milk" is sold as an oat drink
 * (kauramaito: kaurajuoma, havremjölk: havredryck), because only dairy may be called milk.
 */
const SPOKEN_NAMES: [RegExp, string][] = [
  [/(?<![a-z])kaura ?mai(?:to|do)[a-z]*/g, "kaurajuoma"],
  [/(?<![a-z])oat ?milks?(?![a-z])/g, "oat drink"],
  [/(?<![a-z])havre ?mjolk[a-z]*/g, "havredryck"],
];

export function parseQueryText(text: string): ParsedQuery {
  let s = ` ${fold(text).replace(/-/g, " ").replace(/\s+/g, " ")} `;
  for (const [re, to] of SPOKEN_NAMES) s = s.replace(re, to);
  const claims: string[] = [];
  const excludeAllergens: string[] = [];
  for (const [claim, phrases] of CLAIM_PHRASES) {
    for (const ph of [...phrases].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?<![a-z])${ph}(?![a-z])`, "g");
      if (re.test(s)) {
        if (!claims.includes(claim)) claims.push(claim);
        s = s.replace(re, " ");
      }
    }
  }
  for (const [allergen, phrases] of EXCLUSION_PHRASES) {
    for (const ph of phrases) {
      const re = new RegExp(`(?<![a-z])${ph}(?![a-z])`, "g");
      if (re.test(s)) {
        if (!excludeAllergens.includes(allergen)) excludeAllergens.push(allergen);
        s = s.replace(re, " ");
      }
    }
  }
  const out: ParsedQuery = { terms: [], claims, excludeAllergens };
  for (const m of s.matchAll(AMOUNT_RE)) {
    const raw = m[1];
    const value = /^\d{1,3}(?:[ ,]\d{3})+$/.test(raw) ? Number(raw.replace(/[ ,]/g, "")) : Number(raw.replace(",", "."));
    const u = m[2];
    const amount: Amount =
      u === "dl" ? { amount: value / 10, unit: "L" } : u === "cl" ? { amount: value / 100, unit: "L" } : u === "ml" ? { amount: value / 1000, unit: "L" } : u === "g" ? { amount: value / 1000, unit: "kg" } : u.startsWith("k") ? { amount: value, unit: "kg" } : { amount: value, unit: "L" };
    if (amount.amount <= 25) out.packSize ??= amount;
    else out.orderAmount ??= amount;
  }
  s = s.replace(AMOUNT_RE, " ");
  out.terms = [...new Set(tokenize(s).filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t) && t.length > 1))];
  return out;
}

// ---------- product kinds that share words with others ----------

/**
 * Words that make a product a different kind of thing from what a plain query asks for: "milk" should not
 * surface coffee milk portions, chocolate milk, sour milk or cream unless the query says so.
 */
const FACETS: { id: string; words: string[] }[] = [
  { id: "coffee", words: ["coffee", "kahvi", "kaffe", "latte", "cafe", "cappuccino", "espresso", "mokka", "mocha", "barista"] },
  { id: "chocolate", words: ["chocolate", "choco", "suklaa", "choklad", "cocoa", "kaakao", "kakao"] },
  { id: "cream", words: ["cream", "kerma", "gradde", "creme", "fraiche"] },
  { id: "yoghurt", words: ["yoghurt", "yogurt", "jogurt", "soygurt", "skyr"] },
  { id: "fermented", words: ["sour", "piima", "filmjolk", "surmjolk", "kefir", "viili", "fermented", "acidophilus", "acidofilus", "gefilus", "bifidus", "kulturmjolk"] },
  { id: "quark", words: ["quark", "rahka", "kvarg"] },
  { id: "powder", words: ["powder", "jauhe", "pulver"] },
  { id: "coconut", words: ["coconut", "kookos", "kokos"] },
  { id: "peanut", words: ["peanut", "maapahkina", "jordnot"] },
  { id: "condensed", words: ["condensed", "kondensoitu", "kondenserad", "tiiviste"] },
  { id: "portion", words: ["portion", "annos", "sachet", "portioner"] },
  { id: "shake", words: ["shake", "pirtelo", "smoothie"] },
  { id: "dessert", words: ["jaatelo", "pudding", "vanukas", "dessert", "jalkiruoka", "porridge", "puuro", "glass"] },
  { id: "cheese", words: ["cheese", "juusto", "ost"] },
  { id: "butter", words: ["butter", "smor", "voi"] },
  { id: "flavoured", words: ["vanilla", "vanilja", "vanilj", "strawberry", "mansikka", "jordgubb", "banana", "banaani", "raspberry", "vadelma", "hallon", "blueberry", "mustikka", "caramel", "karamelli", "toffee"] },
  { id: "snack", words: ["snack", "valipala", "mellanmal"] },
  { id: "sauce_soup", words: ["soup", "keitto", "soppa", "sauce", "kastike", "dressing"] },
];
const FACET_PENALTY = 0.3;

function hasWord(tokens: string[], text: string, word: string): boolean {
  if (word.length <= 3) return tokens.includes(word);
  return text.includes(word);
}

/** The kinds of product a text names ("coffee", "fermented", "portion", ...): see FACETS. */
export function facetsOf(text: string): string[] {
  const folded = ` ${fold(text)} `;
  const tokens = tokenize(text);
  return FACETS.filter((f) => f.words.some((w) => hasWord(tokens, folded, w))).map((f) => f.id);
}

/** The kinds a product's names make it: coffee milk is "coffee", sour milk "fermented". Empty for a plain product. */
export function productFacets(p: IndexedProduct): string[] {
  return facetsOf([p.names.en, p.names.fi, p.names.sv].filter(Boolean).join(" "));
}

// ---------- the lexical backend ----------

type Doc = { p: IndexedProduct; tokens: string[]; text: string; facets: Set<string>; nameLength: number };

export function allergenEvidence(p: IndexedProduct, allergen: string): AllergenEvidence {
  if (p.allergens.contains.includes(allergen)) return "contains";
  if (p.allergens.mayContain.includes(allergen)) return "may_contain";
  if (p.allergens.freeFrom.includes(allergen)) return "free_from";
  if (p.allergens.declared) return "not_declared";
  const n = natureOf(p);
  return n ? (n.allergens.includes(allergen) ? "contains" : "by_nature") : "unknown";
}

/** An index record as the claim-evidence check reads it (core/claim-evidence.ts), with its by-nature evidence when registered. */
export function subjectOfIndexed(p: IndexedProduct): ClaimSubject {
  const n = p.allergens.declared ? undefined : natureOf(p);
  const ing = p.allergens.declared ? undefined : wholeIngredients(p.texts?.ingredients);
  return { claims: p.claims, category: p.categoryCode, declared: p.allergens.declared, present: [...p.allergens.contains, ...p.allergens.mayContain], ...(n ? { byNature: n } : {}), ...(ing ? { ingredients: ing } : {}) };
}

export class LexicalSearch implements SearchBackend {
  private readonly docs: Doc[];
  private readonly byId: Map<string, Doc>;

  constructor(products: IndexedProduct[]) {
    this.docs = products.map((p) => {
      const names = [p.names.en, p.names.fi, p.names.sv].filter(Boolean).join(" ");
      const text = ` ${fold(`${names} ${p.brand ?? ""}`)} `;
      const tokens = [...new Set(tokenize(text))];
      const facets = new Set(FACETS.filter((f) => f.words.some((w) => hasWord(tokens, text, w))).map((f) => f.id));
      return { p, tokens, text, facets, nameLength: (p.names.en ?? p.names.fi ?? "").length };
    });
    this.byId = new Map(this.docs.map((d) => [d.p.id, d]));
  }

  get size(): number {
    return this.docs.length;
  }

  get(id: string): IndexedProduct | undefined {
    return this.byId.get(id)?.p;
  }

  search(query: SearchQuery): SearchHit[] {
    const parsed = parseQueryText(query.text ?? "");
    const claims = [...new Set([...(query.requiredClaims ?? []), ...parsed.claims])];
    const forbidden = [...new Set([...(query.forbiddenAllergens ?? []), ...parsed.excludeAllergens])];
    const proof = query.allergenProof ?? "declared";
    const codes = query.category ? new Set(categoryCodesFor(query.category)) : null;
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 100);
    const minC = query.minPackContent;
    const queryText = ` ${fold(query.text ?? "")} `;
    const queryTokens = tokenize(query.text ?? "");
    const queryFacets = new Set(FACETS.filter((f) => f.words.some((w) => hasWord(queryTokens, queryText, w))).map((f) => f.id));

    // 1. Hard filters.
    const pool = (query.ids ? query.ids.map((id) => this.byId.get(id)).filter((d): d is Doc => Boolean(d)) : this.docs).filter((d) => {
      const p = d.p;
      if (codes && !codes.has(p.categoryCode)) return false;
      // Plain search stays strict on allergens by nature, here as for a forbidden allergen; the declaration counts.
      if (!claims.every((c) => claimEvidence(subjectOfIndexed(p), c, { strict: true }).met)) return false;
      if (minC && !(p.pack.certainMeasures.includes(minC.unit) && (p.pack.perSalesUnit[minC.unit] ?? 0) >= minC.amount)) return false;
      for (const a of forbidden) {
        const e = allergenEvidence(p, a);
        // Plain search stays strict: a product without allergen data is out, by its nature or not.
        if (e === "contains" || e === "may_contain" || e === "unknown" || e === "by_nature") return false;
        if (proof === "free_from" && e !== "free_from") return false;
      }
      return true;
    });

    // 2. Text relevance: every term must match somewhere (whole word, compound part, or stem).
    const terms = parsed.terms;
    const quality = (d: Doc, t: string): number => {
      if (d.tokens.includes(t)) return 1;
      if (t.length >= 4) {
        if (d.tokens.some((k) => k.startsWith(t) || k.endsWith(t))) return 0.75;
        if (d.text.includes(t)) return 0.55;
      }
      if (t.length >= 5) {
        for (const cut of [1, 2]) {
          const stem = t.slice(0, -cut);
          if (d.tokens.some((k) => k.startsWith(stem))) return 0.5;
        }
      }
      return 0;
    };
    const idf = new Map<string, number>();
    for (const t of terms) {
      const df = pool.reduce((n, d) => n + (quality(d, t) > 0 ? 1 : 0), 0);
      idf.set(t, Math.log(1 + pool.length / Math.max(df, 1)));
    }
    const totalIdf = terms.reduce((s, t) => s + idf.get(t)!, 0) || 1;

    type Scored = { d: Doc; score: number; why: string[] };
    const scoreAll = (maxMissing: number): Scored[] => {
      const out: Scored[] = [];
      for (const d of pool) {
        let s = 0;
        const missing: string[] = [];
        for (const t of terms) {
          const q = quality(d, t);
          if (q === 0) missing.push(t);
          s += q * idf.get(t)!;
        }
        if (missing.length > maxMissing) continue;
        out.push({ d, score: terms.length ? s / totalIdf : 1, why: missing.length ? [`no match for ${missing.join(", ")}`] : [] });
      }
      return out;
    };
    // All terms must match; if nothing does, accept hits that miss up to half of them, ranked lower by score.
    let scored = scoreAll(0);
    if (scored.length === 0 && terms.length > 1) scored = scoreAll(Math.floor(terms.length / 2));

    // 3. Different kinds of product that merely share a word ("milk" in coffee milk, chocolate milk, sour milk).
    for (const x of scored) {
      const extra = [...x.d.facets].filter((f) => !queryFacets.has(f));
      if (extra.length && terms.length) {
        x.score *= FACET_PENALTY ** Math.min(extra.length, 2);
        x.why.push(`ranked down: ${extra.join(", ")} not asked for`);
      }
    }

    // 4. Category coherence: the category most of the best matches share is probably what was meant.
    if (terms.length && scored.length > 3) {
      const top = [...scored].sort((a, b) => b.score - a.score || a.d.nameLength - b.d.nameLength).slice(0, 20);
      const mass = new Map<string, number>();
      for (const x of top) mass.set(x.d.p.categoryCode, (mass.get(x.d.p.categoryCode) ?? 0) + x.score);
      const total = [...mass.values()].reduce((a, b) => a + b, 0);
      const [bestCat, bestMass] = [...mass.entries()].sort((a, b) => b[1] - a[1])[0];
      if (bestMass / total >= 0.35) {
        for (const x of scored) if (x.d.p.categoryCode === bestCat) x.score *= 1.4;
      }
    }

    // 5. Pack size and measure hints from the query.
    for (const x of scored) {
      const pk = x.d.p.pack;
      const want = parsed.packSize;
      if (want) {
        const base = pk.perBaseUnit[want.unit];
        const sales = pk.perSalesUnit[want.unit];
        if ((base !== undefined && Math.abs(base - want.amount) < 1e-6) || (sales !== undefined && Math.abs(sales - want.amount) < 1e-6)) {
          x.score *= 1.5;
          x.why.push(`pack size ${want.amount} ${want.unit} as asked`);
        }
      }
      // A large order ("1,000 litres") is better served by bigger packs: fewer units to handle and deliver.
      const order = parsed.orderAmount;
      if (order && pk.certainMeasures.includes(order.unit)) {
        const per = pk.perSalesUnit[order.unit] ?? 0;
        if (per > 1) x.score *= 1 + 0.15 * Math.log10(Math.min(per, order.amount));
      }
      const measure: Measure | undefined = parsed.orderAmount?.unit ?? want?.unit;
      if (measure && !pk.certainMeasures.includes(measure)) {
        x.score *= 0.8;
        x.why.push(`content per ${pk.salesUnit} in ${measure} not certain`);
      }
    }

    scored = scored.sort((a, b) => b.score - a.score || Number(b.d.p.pack.certain) - Number(a.d.p.pack.certain) || a.d.nameLength - b.d.nameLength || a.d.p.id.localeCompare(b.d.p.id));
    return scored.slice(0, limit).map((x) => {
      const hit: SearchHit = { product: x.d.p, score: Math.round(x.score * 1000) / 1000, why: x.why };
      if (claims.length) hit.why.unshift(`carries ${claims.join(", ")}`);
      if (forbidden.length) hit.allergens = Object.fromEntries(forbidden.map((a) => [a, allergenEvidence(x.d.p, a)]));
      return hit;
    });
  }
}
