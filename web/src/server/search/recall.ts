import type { IndexedProduct } from "@/core/catalog/partner";
import { categoryCodesFor } from "@/core/catalog/partner";
import { allergenEvidence, fold, parseQueryText, tokenize } from "@/core/catalog/search";
import type { KnowledgeMap } from "@/server/knowledge/map";
import { DISH_USES, USES, type Use } from "@/server/knowledge/vocab";
import type { ProductVectors } from "./vectors";

/**
 * Recall that does not miss: from the buyer's words, gather candidates from the whole assortment by every cheap
 * means at once, each under the same hard filters, and fuse their rankings.
 *
 *   lexical   the words in the product names, any of the three languages, whole or as part of a compound, from an
 *             inverted index (products carrying all the words first)
 *   typo      the same after correcting words no product name has to the nearest word one does ("spagetti"), or
 *             an inflected Finnish or Swedish form to its stem ("jätesäkkejä")
 *   words     any of the words, rarer words weighing more, for requests whose other words name no product
 *   kinds     the knowledge map's kinds whose label or aliases (English, Finnish, Swedish) carry the words, all their products
 *   vectors   semantic nearest neighbours of the query embedding (vectors.ts)
 *   code      a product id said outright
 *
 * Fusion is reciprocal rank (each source's rank, weighted), plus a lift for products the map profiles for a use the
 * words name ("for whipping", "for coffee"). Plain code, deterministic for a given query vector.
 */

export type Source = "lexical" | "typo" | "words" | "kinds" | "vectors" | "code";
export type Signals = Partial<Record<Source, boolean>>;
export const ALL_SIGNALS: Required<Signals> = { lexical: true, typo: true, words: true, kinds: true, vectors: true, code: true };

export type Understood = {
  text: string;
  terms: string[];
  /** Claims every hit must carry: the words', the request's, and near-misses of claim words (never fewer). */
  claims: string[];
  forbiddenAllergens: string[];
  notes: string[];
  uses: Use[];
  codes: string[];
  brand?: string;
  pack?: { amount: number; unit: "L" | "kg" };
  corrections: Record<string, string>;
};

/** The share of the candidate set each source is sure of (its own top ranks), before the rest is filled by fused score. */
const QUOTA: Partial<Record<Source, number>> = { vectors: 0.25, kinds: 0.2, lexical: 0.15, typo: 0.1, words: 0.05 };

export type Candidate = { id: string; score: number; sources: Source[] };

// ---------- edit distance ----------

/** Optimal-string-alignment distance, giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** Finnish and Swedish case and plural endings, longest first (folded: ä -> a, ö -> o). */
const INFLECTIONS = ["iksi", "ille", "illa", "ilta", "ista", "issa", "ihin", "eihin", "eita", "eja", "ita", "oita", "ia", "ja", "aa", "oon", "aan", "een", "iin", "ksi", "lle", "lla", "sta", "ssa", "na", "erna", "arna", "orna", "en", "et", "er", "ar", "or", "an", "a", "n", "t", "e", "i"];

const maxEdits = (t: string) => (t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0);

// ---------- claim words read with care ----------

/**
 * Single words that state a dietary claim, for near-miss reading: a misspelt "laktositon" still means the buyer
 * asked for lactose-free, so the claim is applied (stricter, never looser) and the note says so.
 */
const CLAIM_WORDS: [string, string][] = [
  ["lactose_free", "laktoositon"], ["lactose_free", "laktoositonta"], ["lactose_free", "laktoosittomia"], ["lactose_free", "laktoositonna"], ["lactose_free", "laktoosittoman"],
  ["lactose_free", "laktosfri"], ["lactose_free", "laktosfria"], ["lactose_free", "laktosfritt"], ["lactose_free", "lactosefree"],
  ["gluten_free", "gluteeniton"], ["gluten_free", "gluteenitonta"], ["gluten_free", "gluteenittomia"], ["gluten_free", "gluteenittoman"], ["gluten_free", "glutenfri"], ["gluten_free", "glutenfria"], ["gluten_free", "glutenfritt"], ["gluten_free", "glutenfree"],
  ["vegan", "vegaaninen"], ["vegan", "vegaanista"], ["vegan", "vegaanisia"], ["vegan", "vegansk"], ["vegan", "veganska"], ["vegan", "veganskt"],
  ["low_lactose", "vahalaktoosinen"], ["low_lactose", "vahalaktoosista"],
  ["organic", "ekologisk"], ["organic", "ekologiska"],
];
/** Words with their own meaning a near-miss must not be read as a claim word. */
const NOT_CLAIM = new Set(["glutenia", "laktoosi", "vegaani", "vegaaneille", "laktoosia"]);

/** Inflected or compound claim words the core's phrase list does not have ("veganskt", "gluteenittoman"). */
function claimsFromWords(tokens: string[]): { claims: string[]; read: [string, string][] } {
  const claims: string[] = [];
  const read: [string, string][] = [];
  for (const t of tokens) {
    if (t.length < 6 || NOT_CLAIM.has(t)) continue;
    for (const [claim, w] of CLAIM_WORDS) {
      const d = t === w ? 0 : editDistance(t, w, 2);
      if (d === 0 || (d <= (w.length >= 9 ? 2 : 1) && t.slice(0, 3) === w.slice(0, 3))) {
        if (!claims.includes(claim)) claims.push(claim);
        if (d > 0) read.push([t, claim]);
        break;
      }
    }
  }
  return { claims, read };
}

/** Stems of allergen words in the three languages, for "without X", "X-free", "X allergy", "ilman X", "utan X". */
const ALLERGEN_STEMS: [string, string][] = [
  ["maapahkin", "peanuts"], ["peanut", "peanuts"], ["jordnot", "peanuts"],
  ["pahkin", "nuts"], ["nut", "nuts"], ["not", "nuts"], ["notter", "nuts"],
  ["soij", "soy"], ["soy", "soy"], ["soja", "soy"],
  ["maito", "milk"], ["maido", "milk"], ["milk", "milk"], ["mjolk", "milk"], ["dairy", "milk"], ["laktoosi", "lactose"], ["lactose", "lactose"], ["laktos", "lactose"],
  ["kananmun", "eggs"], ["muna", "eggs"], ["egg", "eggs"], ["agg", "eggs"],
  ["gluten", "gluten"], ["gluteen", "gluten"], ["vehna", "wheat"], ["wheat", "wheat"],
  ["seesam", "sesame"], ["sesam", "sesame"], ["fish", "fish"], ["kala", "fish"], ["fisk", "fish"],
  ["selleri", "celery"], ["celery", "celery"], ["sinap", "mustard"], ["senap", "mustard"], ["mustard", "mustard"],
  ["shellfish", "crustaceans"], ["shrimp", "crustaceans"], ["katkarap", "crustaceans"], ["rak", "crustaceans"],
];
function allergenFromWord(w: string): string | undefined {
  for (const [stem, a] of ALLERGEN_STEMS) if (w === stem || (w.startsWith(stem) && (stem.length >= 4 || w.length <= stem.length + 3))) return a;
  return undefined;
}

/** "without nuts", "nut-free", "soy allergy", "ilman pähkinöitä", "pähkinätön", "utan nötter", "nötfri": never fewer exclusions than said. */
function exclusionsFromWords(text: string): { allergens: string[]; words: string[] } {
  const s = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  const found: { a: string; w: string }[] = [];
  const take = (w: string | undefined, also?: string) => {
    if (!w) return;
    const a = allergenFromWord(w);
    if (a) found.push({ a, w: also ?? w });
  };
  for (const m of s.matchAll(/ (?:without|no|ilman|utan|inga|ingen) ([a-z]+)(?: (?:or|and|tai|ja|eller|och) ([a-z]+))?/g)) {
    take(m[1], `${m[0].trim()}`);
    take(m[2]);
  }
  for (const m of s.matchAll(/ ([a-z]+?) ?(?:free|allergy|allergic|allergia|allergiselle|allergisille|allergikko|allergi|allergiker)\b/g)) take(m[1], m[0].trim());
  for (const m of s.matchAll(/ allergic to ([a-z]+)/g)) take(m[1], m[0].trim());
  for (const m of s.matchAll(/ ([a-z]{3,}?)(?:ton|tonta|ttomia|ttoman|ttomat|ttomana|tön)\b/g)) take(m[1], m[0].trim());
  for (const m of s.matchAll(/ ([a-z]{3,}?)(?:fri|fria|fritt)\b/g)) take(m[1], m[0].trim());
  const allergens = [...new Set(found.map((f) => f.a))].filter((a) => a !== "lactose" || !/laktoositon|laktosfri|lactose ?free/.test(s));
  return { allergens, words: found.filter((f) => allergens.includes(f.a)).map((f) => f.w) };
}

/** Words a cook says that name no product: dropped before the per-word and kind searches. */
const GENERIC = new Set(
  (
    "kitchen kitchens keittio keittioon keittiolle keittiossa kok koket koket koksbruk restaurant ravintola ravintolaan ravintolalle restaurang restaurangen " +
    "something anything stuff thing things some any kind sort good nice fresh new usual normal regular kids kid children child school daycare without with what which our us we me my need needed want wanted " +
    "ingredients ingredient everything all make making cook cooking recipe for the of and or to in on a an please send get order buy tomorrow week weeks " +
    "jotain jotakin mitä mita meille meidan tarvitaan tarvitsen tarvittais tarttis tarvis tilaa tilata lapsille lasten ilman kanssa ainekset aineet kaikki tehdä tehda " +
    "nagot nagot något nagonting behover vi oss till barn barnen utan med allt ingredienser lite"
  ).split(" ").map(fold),
);

/** Words that name a use of a product (beyond the map's dish list), English, Finnish, Swedish. */
const USE_WORDS: Record<string, Use[]> = {
  whipping: ["whipping"], vispata: ["whipping"], vispaukseen: ["whipping"], vispikerma: ["whipping"], vispa: ["whipping"], vispgradde: ["whipping"],
  frying: ["frying"], paistaa: ["frying"], paistamiseen: ["frying"], fritera: ["frying"], stek: ["frying"], steka: ["frying"], uppopaisto: ["frying"], friteeraus: ["frying"],
  baking: ["baking"], bake: ["baking"], leivonta: ["baking"], leivontaan: ["baking"], baka: ["baking"], bakning: ["baking"],
  kahviin: ["coffee"], kaffet: ["coffee"], kaffe: ["coffee"],
  pizzaan: ["pizza"], gratinointiin: ["gratin", "melting"], gratinera: ["gratin", "melting"],
  kastikkeeseen: ["sauce"], sas: ["sauce"], saas: ["sauce"], keittoon: ["soup"], soppa: ["soup"],
  salaattiin: ["salad"], sallad: ["salad"], jalkiruoaksi: ["dessert"], jalkiruoka: ["dessert"], efterratt: ["dessert"], dessert: ["dessert"], desserts: ["dessert"],
  aamupala: ["breakfast"], aamupalalle: ["breakfast"], frukost: ["breakfast"], grilling: ["grilling"], grillaus: ["grilling"], grillata: ["grilling"], grilla: ["grilling"],
};

function usesOf(tokens: string[]): Use[] {
  const out = new Set<Use>();
  for (const t of tokens) {
    for (const u of DISH_USES[t] ?? USE_WORDS[t] ?? (t.endsWith("s") ? DISH_USES[t.slice(0, -1)] : undefined) ?? []) out.add(u);
    if ((USES as readonly string[]).includes(t)) out.add(t as Use);
  }
  return [...out];
}

// ---------- the index ----------

type KindEntry = { key: string; tokens: string[]; size: number };

export class SearchIndex {
  readonly products: IndexedProduct[];
  readonly byId: Map<string, IndexedProduct>;
  readonly map: KnowledgeMap | null;
  readonly vectors: ProductVectors | null;
  private readonly vocab = new Map<string, number>();
  private readonly vocabByLen = new Map<number, string[]>();
  private readonly kinds: KindEntry[] = [];
  private readonly kindProducts = new Map<string, string[]>();
  /** Brand words: products whose brand or vendor carries the word, and products whose names do. */
  private readonly brandWords = new Map<string, { inBrand: number; inName: number }>();
  private readonly nameTokens = new Map<string, Set<string>>();
  /** Word -> products whose names (any language) or brand carry it. */
  private readonly postings = new Map<string, string[]>();
  private readonly nameLength = new Map<string, number>();
  private readonly termCache = new Map<string, [string, number][]>();

  constructor(products: IndexedProduct[], map: KnowledgeMap | null, vectors: ProductVectors | null) {
    this.products = products;
    this.byId = new Map(products.map((p) => [p.id, p]));
    this.map = map;
    this.vectors = vectors;
    const add = (t: string, n = 1) => this.vocab.set(t, (this.vocab.get(t) ?? 0) + n);
    const word = (t: string) => t.length >= 3 && !/\d/.test(t);
    const names = new Map<string, string[]>();
    const brands = new Map<string, Set<string>>();
    for (const p of products) {
      const nt = tokenize([p.names.en, p.names.fi, p.names.sv].filter(Boolean).join(" "));
      const bw = new Set(tokenize(`${p.brand ?? ""} ${p.vendor ?? ""}`).filter(word));
      names.set(p.id, nt);
      brands.set(p.id, bw);
      const toks = new Set([...nt.filter(word), ...tokenize(p.brand ?? "").filter(word)]);
      this.nameTokens.set(p.id, toks);
      this.nameLength.set(p.id, (p.names.en ?? p.names.fi ?? "").length);
      for (const t of toks) {
        add(t);
        const l = this.postings.get(t);
        if (l) l.push(p.id);
        else this.postings.set(t, [p.id]);
      }
      for (const t of bw) {
        const e = this.brandWords.get(t) ?? { inBrand: 0, inName: 0 };
        e.inBrand++;
        this.brandWords.set(t, e);
      }
      const prof = map?.profile(p.id);
      if (prof) {
        const l = this.kindProducts.get(prof.kind) ?? [];
        l.push(p.id);
        this.kindProducts.set(prof.kind, l);
      }
    }
    // A brand word in the names of products of other brands counts against it being a brand ("valio" vs "kerma").
    for (const p of products) {
      const bw = brands.get(p.id)!;
      for (const t of new Set(names.get(p.id))) {
        if (bw.has(t)) continue;
        const e = this.brandWords.get(t);
        if (e) e.inName++;
      }
    }
    if (map) {
      for (const k of map.kinds.values()) {
        const tokens = [...new Set([k.label, ...k.aliases].flatMap((s) => tokenize(s)).filter((t) => t.length >= 3))];
        for (const t of tokens) add(t, 1);
        this.kinds.push({ key: k.key, tokens, size: this.kindProducts.get(k.key)?.length ?? 0 });
      }
    }
    for (const t of this.vocab.keys()) {
      const l = this.vocabByLen.get(t.length) ?? [];
      l.push(t);
      this.vocabByLen.set(t.length, l);
    }
  }

  /** The nearest word any product name or kind uses, for a word none does; undefined when it is known or too far. */
  correct(t: string): string | undefined {
    if (this.vocab.has(t) || /\d/.test(t)) return undefined;
    const max = maxEdits(t);
    if (!max) return undefined;
    let best: { w: string; d: number; n: number } | undefined;
    for (let len = t.length - max; len <= t.length + max; len++) {
      for (const w of this.vocabByLen.get(len) ?? []) {
        if (w[0] !== t[0] && max < 2) continue;
        const d = editDistance(t, w, max);
        if (d > max) continue;
        const n = this.vocab.get(w)!;
        if (!best || d < best.d || (d === best.d && n > best.n)) best = { w, d, n };
      }
    }
    if (best) return best.w;
    // An inflected Finnish or Swedish form ("jätesäkkejä", "kermaa", "smöret"): strip a case ending, then the most
    // common word that starts with the stem and is at most three letters longer.
    for (const suf of INFLECTIONS) {
      if (!t.endsWith(suf) || t.length - suf.length < 4) continue;
      const stem = t.slice(0, -suf.length);
      let pick: { w: string; n: number } | undefined;
      for (let len = stem.length; len <= stem.length + 3; len++) {
        for (const w of this.vocabByLen.get(len) ?? []) if (w.startsWith(stem) && (!pick || this.vocab.get(w)! > pick.n)) pick = { w, n: this.vocab.get(w)! };
      }
      if (pick) return pick.w;
    }
    return undefined;
  }

  /** Read the words: terms, claims (never fewer than stated), uses, product codes, a brand, a pack size. */
  understand(text: string, extra: { claims?: string[]; forbiddenAllergens?: string[]; itemText?: string } = {}): Understood {
    const parsed = parseQueryText(text);
    const tokens = tokenize(text);
    const fromWords = claimsFromWords(tokens);
    const claims = [...new Set([...(extra.claims ?? []), ...parsed.claims, ...fromWords.claims])];
    const notes = fromWords.read.map(([w, c]) => `read "${w}" as ${c.replace(/_/g, "-")}`);
    // An exclusion the core's phrase list does not know ("without soy", "pähkinätön", "utan nötter"). An allergen whose
    // "-free" claim was read is left to the claim: a gluten-free product without allergen data still counts.
    const CLAIM_OF: Record<string, string> = { gluten: "gluten_free", lactose: "lactose_free", soy: "soy_free", eggs: "egg_free" };
    const excl = exclusionsFromWords(text);
    const extraAllergens = excl.allergens.filter((a) => !(CLAIM_OF[a] && claims.includes(CLAIM_OF[a])) && !parsed.excludeAllergens.includes(a) && !(extra.forbiddenAllergens ?? []).includes(a));
    if (extraAllergens.length) notes.push(`read ${excl.words.map((w) => `"${w}"`).join(", ")} as no ${extraAllergens.join(", ")}`);
    const claimTokens = new Set(fromWords.claims.length ? tokens.filter((t) => CLAIM_WORDS.some(([, w]) => editDistance(t, w, 2) <= 2)) : []);
    const exclTokens = new Set(excl.words.flatMap((w) => tokenize(w)));
    const terms = [...new Set([...parsed.terms, ...(extra.itemText ? parseQueryText(extra.itemText).terms : [])])].filter((t) => !claimTokens.has(t) && !exclTokens.has(t));

    const corrections: Record<string, string> = {};
    for (const t of terms) {
      const c = this.correct(t);
      if (c) corrections[t] = c;
    }
    const codes = [...new Set(text.match(/(?<!\d)\d{6}(?!\d)/g) ?? [])].filter((c) => this.byId.has(c));
    // A brand: a word that is mostly a brand (Oatly, Arla, Philadelphia), not a food word some brand also uses.
    let brand: string | undefined;
    for (const t of new Set(tokens)) {
      const e = this.brandWords.get(t);
      if (!e || t.length < 4 || e.inBrand < 2 || e.inBrand < 3 * e.inName || GENERIC.has(t)) continue;
      if (!brand || (this.brandWords.get(brand)?.inBrand ?? 0) < e.inBrand) brand = t;
    }
    const pack = parsed.packSize && (parsed.packSize.unit === "L" || parsed.packSize.unit === "kg") ? { amount: parsed.packSize.amount, unit: parsed.packSize.unit as "L" | "kg" } : undefined;
    return {
      text,
      terms,
      claims,
      forbiddenAllergens: [...new Set([...(extra.forbiddenAllergens ?? []), ...parsed.excludeAllergens, ...extraAllergens])],
      notes,
      uses: usesOf([...tokens, ...terms.map((t) => corrections[t] ?? t)]),
      codes,
      ...(brand ? { brand } : {}),
      ...(pack ? { pack } : {}),
      corrections,
    };
  }

  /** The hard rules, from product data only: claims carried, no forbidden allergen (unknown is not safe), the family, an id list. */
  hardFilter(u: Pick<Understood, "claims" | "forbiddenAllergens">, opts: { category?: string; ids?: string[] } = {}): (p: IndexedProduct) => boolean {
    const codes = opts.category ? new Set(categoryCodesFor(opts.category)) : null;
    const ids = opts.ids ? new Set(opts.ids) : null;
    return (p) => {
      if (ids && !ids.has(p.id)) return false;
      if (codes && !codes.has(p.categoryCode)) return false;
      if (!u.claims.every((c) => p.claims.includes(c))) return false;
      for (const a of u.forbiddenAllergens) {
        const e = allergenEvidence(p, a);
        if (e === "contains" || e === "may_contain" || e === "unknown") return false;
      }
      return true;
    };
  }

  packMatches(p: IndexedProduct, pack: { amount: number; unit: "L" | "kg" }): boolean {
    const near = (a: number | undefined) => a !== undefined && Math.abs(a - pack.amount) <= Math.max(0.03 * pack.amount, 1e-6);
    const single = p.pack.baseUnitsPerSalesUnit === 1 || p.pack.baseUnitsPerSalesUnit === null;
    return near(p.pack.perBaseUnit[pack.unit]) || (single && near(p.pack.perSalesUnit[pack.unit]));
  }

  brandMatches(p: IndexedProduct, brand: string): boolean {
    return fold(`${p.brand ?? ""} ${p.vendor ?? ""}`).includes(brand);
  }

  /** Name words a query word matches: itself (1), a compound starting or ending with it (0.75), containing it (0.55). */
  private wordMatches(t: string): [string, number][] {
    const hit = this.termCache.get(t);
    if (hit) return hit;
    const out: [string, number][] = [];
    if (this.postings.has(t)) out.push([t, 1]);
    if (t.length >= 4) {
      for (const w of this.postings.keys()) {
        if (w === t || w.length <= t.length) continue;
        if (w.startsWith(t) || w.endsWith(t)) out.push([w, 0.75]);
        else if (t.length >= 5 && w.includes(t)) out.push([w, 0.55]);
      }
    }
    this.termCache.set(t, out);
    if (this.termCache.size > 5000) this.termCache.delete(this.termCache.keys().next().value!);
    return out;
  }

  /**
   * Products by their names' words, from an inverted index (a few milliseconds over the whole assortment). "and":
   * products carrying more of the words first; "or": by the words' summed weight (rarer words weigh more).
   */
  keywordRank(terms: string[], mode: "and" | "or", allow: (p: IndexedProduct) => boolean, limit: number): string[] {
    if (!terms.length) return [];
    const n = this.products.length;
    const score = new Map<string, { s: number; c: number }>();
    for (const t of terms) {
      const best = new Map<string, number>();
      for (const [w, q] of this.wordMatches(t)) for (const id of this.postings.get(w) ?? []) if ((best.get(id) ?? 0) < q) best.set(id, q);
      if (!best.size) continue;
      const idf = Math.log(1 + n / best.size);
      for (const [id, q] of best) {
        const e = score.get(id) ?? { s: 0, c: 0 };
        e.s += q * idf;
        e.c += 1;
        score.set(id, e);
      }
    }
    const ranked: { id: string; s: number; c: number }[] = [];
    for (const [id, e] of score) if (allow(this.byId.get(id)!)) ranked.push({ id, ...e });
    ranked.sort((a, b) => (mode === "and" ? b.c - a.c : 0) || b.s - a.s || this.nameLength.get(a.id)! - this.nameLength.get(b.id)! || a.id.localeCompare(b.id));
    return ranked.slice(0, limit).map((r) => r.id);
  }

  /** Kinds whose label or aliases carry the words (exact, compound part, or typo-corrected), best first. */
  matchKinds(u: Understood, max = 24): { key: string; score: number }[] {
    const terms = u.terms.filter((t) => !GENERIC.has(t));
    if (!terms.length || !this.kinds.length) return [];
    const scored: { key: string; score: number }[] = [];
    for (const k of this.kinds) {
      if (!k.size) continue;
      let s = 0;
      for (const t of terms) {
        const c = u.corrections[t];
        let best = 0;
        for (const h of k.tokens) {
          if (h === t || h === c) best = 1;
          else if (t.length >= 4 && h.length >= 4 && (h.startsWith(t) || t.startsWith(h) || h.endsWith(t) || t.endsWith(h))) best = Math.max(best, 0.7);
          else if (t.length >= 5 && h.length >= 5 && (h.includes(t) || t.includes(h))) best = Math.max(best, 0.55);
          if (best === 1) break;
        }
        s += best;
      }
      if (s > 0) scored.push({ key: k.key, score: s / terms.length });
    }
    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const top = scored[0]?.score ?? 0;
    return scored.filter((x) => x.score >= Math.max(0.45, top * 0.7)).slice(0, max);
  }

  /** Every source at once, each under the hard filter, fused. `queryVector`: the request's embedding, when there is one. */
  recall(u: Understood, opts: { size: number; signals?: Signals; filter: (p: IndexedProduct) => boolean; queryVector?: Float32Array; category?: string; ids?: string[] }): Candidate[] {
    const sig = { ...ALL_SIGNALS, ...(opts.signals ?? {}) };
    const lists: { source: Source; weight: number; ids: string[] }[] = [];
    const allow = opts.filter;
    const contentTerms = u.terms.filter((t) => !GENERIC.has(t));
    if (sig.code && u.codes.length) lists.push({ source: "code", weight: 20, ids: u.codes.filter((id) => allow(this.byId.get(id)!)) });
    // Keywords from the inverted index: all the words first, then the misspelt ones corrected, then any of them.
    if (sig.lexical) lists.push({ source: "lexical", weight: 1, ids: this.keywordRank(contentTerms.length ? contentTerms : u.terms, "and", allow, 100) });
    if (sig.typo && Object.keys(u.corrections).length) lists.push({ source: "typo", weight: 0.9, ids: this.keywordRank(contentTerms.map((t) => u.corrections[t] ?? t), "and", allow, 80) });
    if (sig.words && contentTerms.length > 1) lists.push({ source: "words", weight: 0.6, ids: this.keywordRank([...new Set(contentTerms.flatMap((t) => (u.corrections[t] ? [t, u.corrections[t]] : [t])))], "or", allow, 80) });
    const sims = new Map<string, number>();
    if (sig.vectors && this.vectors && opts.queryVector) {
      const near = this.vectors.nearest(opts.queryVector, Math.max(opts.size, 60), (id) => {
        const p = this.byId.get(id);
        return !!p && allow(p);
      });
      for (const n of near) sims.set(n.id, n.sim);
      lists.push({ source: "vectors", weight: 1, ids: near.map((n) => n.id) });
    }
    if (sig.kinds && this.map) {
      const kinds = this.matchKinds(u);
      const ranked: { id: string; s: number }[] = [];
      for (const k of kinds) {
        for (const id of this.kindProducts.get(k.key) ?? []) {
          const p = this.byId.get(id)!;
          if (!allow(p)) continue;
          const toks = this.nameTokens.get(id)!;
          const nameHit = contentTerms.filter((t) => toks.has(t) || toks.has(u.corrections[t] ?? "")).length / Math.max(contentTerms.length, 1);
          ranked.push({ id, s: k.score + 0.3 * nameHit + (sims.get(id) ?? 0) * 0.5 });
        }
      }
      ranked.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
      lists.push({ source: "kinds", weight: 1, ids: [...new Set(ranked.map((r) => r.id))].slice(0, 200) });
    }
    // Reciprocal rank fusion. Each word's own list counts once per product (its best rank).
    const fused = new Map<string, Candidate>();
    for (const l of lists) {
      l.ids.forEach((id, rank) => {
        const c = fused.get(id) ?? { id, score: 0, sources: [] };
        const add = l.weight / (60 + rank);
        if (l.source === "words" && c.sources.includes("words")) c.score += add * 0.5;
        else c.score += add;
        if (!c.sources.includes(l.source)) c.sources.push(l.source);
        fused.set(id, c);
      });
    }
    if (u.uses.length && this.map) {
      for (const c of fused.values()) {
        const uses = this.map.profile(c.id)?.uses ?? [];
        const pos = Math.min(...u.uses.map((x) => (uses.indexOf(x) < 0 ? 99 : uses.indexOf(x))));
        if (pos < 99) c.score *= 1.25 - Math.min(pos, 4) * 0.04;
      }
    }
    // Every source keeps its own best few among the candidates, so one source's consensus on a stray word cannot
    // crowd out another's right answer (the vectors' "disposable gloves" for "kertakäyttöhanskoja keittiöön").
    const all = [...fused.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const chosen = new Set<string>();
    for (const l of lists) {
      const quota = l.source === "code" ? l.ids.length : Math.ceil(opts.size * (QUOTA[l.source] ?? 0));
      let n = 0;
      for (const id of l.ids) {
        if (n >= quota || chosen.size >= opts.size) break;
        if (!chosen.has(id)) chosen.add(id);
        n++;
      }
    }
    for (const c of all) {
      if (chosen.size >= opts.size) break;
      chosen.add(c.id);
    }
    return all.filter((c) => chosen.has(c.id));
  }
}
