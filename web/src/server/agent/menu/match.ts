import type { InMemoryCatalog, Product } from "@/core/catalog";
import { piecesPerSalesUnit, toDockProduct } from "@/core/catalog/product";
import { fold } from "@/core/catalog/search";
import type { ValioCatalog } from "../../valio/valio-catalog";
import type { DraftIngredient } from "./draft";
import { checkSafety, familyOf, type DietRules, type Safety } from "./safety";

/**
 * From an ingredient the model named to products in the catalogue, by master data only (no live call):
 * search with the model's Finnish and English terms, drop what cannot be used (wrong kind of product, a word the
 * dish rules out, a category the mandate does not allow, an unsafe allergen), and rank the rest by how well they
 * fit the ingredient's role. The live price check then sees only the top of this list.
 */

export type Hit = { product: Product; score: number };

/** Master-data search the planner needs. ValioCatalog has ranked hits; the seed catalogue a plain search. */
export interface MenuCatalog {
  search(text: string, limit: number): Promise<Hit[]>;
  get(ids: string[]): Promise<Product[]>;
}

export function menuCatalogOf(c: InMemoryCatalog | ValioCatalog): MenuCatalog {
  if ("search" in c && typeof c.search === "function") {
    const v = c as ValioCatalog;
    return {
      search: async (text, limit) => v.search({ text, limit }).map((h) => ({ product: toDockProduct(h.product), score: h.score })),
      get: (ids) => v.searchProducts({ ids, limit: 100 }),
    };
  }
  return {
    search: async (text, limit) => (await c.searchProducts({ text, limit })).map((product, i) => ({ product, score: 1 / (1 + i * 0.1) })),
    get: (ids) => c.searchProducts({ ids, limit: 100 }),
  };
}

export type Candidate = {
  product: Product;
  score: number;
  safety: Safety;
  /** Why it ranks where it does, in words. */
  why: string[];
};

export type Rejected = { productId: string; name: string; reason: string };

export type CandidateSet = { candidates: Candidate[]; rejected: Rejected[]; searched: string[] };

/** Words in names that make a product a ready dish or a mix, not an ingredient. */
const PREPARED = ["valmis", "ateria", "laatikko", "piiras", "piirakka", "pasteija", "rieska", "terriini", "salaatti", "keitto", "sekoitus", "mix", "flammkuchen", "pizza", "muffinssi", "kakku", "leivos", "pyorykka", "pihvi", "annos", "lastenateria", "sose", "keksi", "cracker", "sipsi", "lastu", "crisps", "chips", "karkki", "dragee", "pastilli", "patukka", "valipala"];
/** Varieties a plain ingredient does not mean: purple carrots, baby potatoes, organic at a premium. */
const VARIETY = ["violetti", "violet", "purple", "keltainen", "yellow", "musta", "valkoinen", "punainen", "rainbow", "baby", "mini", "nappula", "varhais", "luomu", "organic", "premium", "gourmet"];
const FORM_WORDS: Record<string, string[]> = {
  frozen: ["pakaste", "pakastettu", "frozen", "iqf", "jaadytetty"],
  dried: ["kuivattu", "dried", "jauhettu", "rouhittu", "kokonainen"],
  canned_or_jarred: ["sailyke", "tolkki", "purkki", "canned", "jar", "liemessa", "mausteliemessa"],
};

const names = (p: Product) => ` ${fold([p.names?.fi, p.names?.en, p.names?.sv, p.name].filter(Boolean).join(" "))} `;
const hasWord = (hay: string, w: string) => new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay);

// ---------- stock: powder, liquid concentrate and ready stock are dosed differently ----------

export type StockForm = "powder" | "paste" | "liquid_concentrate" | "ready";
const STOCK_WORDS = /(stock|broth|bouillon|buljong|fond|liemi|lient|fumet)/;

/** Is this ingredient a stock, and which form its per-cover amount was written for. Undefined when it is not stock. */
export type StockNeed = "dry" | "paste" | "liquid_concentrate" | "ready";
export function stockNeed(ing: DraftIngredient): StockNeed | undefined {
  const text = fold([ing.key.replace(/_/g, " "), ing.name, ...ing.searchTerms, ing.amountBasis].join(" "));
  if (!STOCK_WORDS.test(text)) return undefined;
  if (ing.perCover.unit === "g") return /(paste|tahna|gel|fond du chef)/.test(text) && !/(powder|jauhe|granul|cube|kuutio)/.test(text) ? "paste" : "dry";
  if (ing.perCover.unit === "ml") return /(concentrate|tiiviste|koncentrat)/.test(text) && !/(ready|valmis|replacing)/.test(text) ? "liquid_concentrate" : "ready";
  return undefined;
}

/** The form of a stock product, from its name and its pack (a powder's pack may say the litres it makes). */
export function stockForm(p: Product): StockForm | undefined {
  const n = names(p);
  if (!STOCK_WORDS.test(n)) return undefined;
  if (/(jauhe|powder|pulver|granul|rake|kuutio|cube|tarning|\d\s*kg\s*\/\s*\d+\s*l\b|\d+\s*g\s*\/\s*l\b)/.test(n)) return "powder";
  if (/(tahna|paste|fond du chef|annosfondi|gel)/.test(n)) return "paste";
  if (/(tiiviste|concentrate|koncentrat|touch of taste)/.test(n)) return "liquid_concentrate";
  if (/(tetra|valmis|ready)/.test(n) || p.unit === "L" || (!!p.packContent?.certainMeasures.includes("L") && !p.packContent.certainMeasures.includes("kg"))) return "ready";
  return p.unit === "kg" || p.packContent?.certainMeasures.includes("kg") ? "powder" : undefined;
}

/**
 * Whether a stock product can be bought by an amount written for another form: grams of powder are not grams of
 * a liquid concentrate (a concentrate takes two to three times as much), and millilitres of ready stock are not
 * millilitres of concentrate (which makes twenty times its volume). Undefined when it can; the reason otherwise.
 */
export function stockMismatch(ing: DraftIngredient, p: Product): string | undefined {
  const need = stockNeed(ing);
  const form = need && stockForm(p);
  if (!need || !form) return undefined;
  const ok: Record<StockNeed, StockForm[]> = { dry: ["powder", "paste"], paste: ["paste", "powder"], liquid_concentrate: ["liquid_concentrate"], ready: ["ready", "powder"] };
  if (ok[need].includes(form)) return undefined;
  const words: Record<StockNeed, string> = { dry: "powder", paste: "paste", liquid_concentrate: "liquid concentrate", ready: "ready-to-use stock" };
  const what = words[need];
  return `${form.replace("_", " ")}, where the ${ing.perCover.amount} ${ing.perCover.unit} per cover is for ${what}: it is dosed differently, so the amount would be wrong`;
}

export function usableMeasure(ing: DraftIngredient, p: Product): boolean {
  const u = ing.perCover.unit;
  if (u === "pcs") return piecesPerSalesUnit(p) !== undefined; // counted only when the pack says how many pieces it holds
  const m = u === "g" ? "kg" : "L";
  if (p.packContent) return p.packContent.certainMeasures.includes(m) || (p.packContent.perSalesUnit[m] ?? 0) > 0;
  return p.unit === m;
}

/**
 * Find and rank products for one ingredient. `allowed` is the mandate's category list: a product outside it would
 * be refused by the gate, so it is never offered.
 */
export async function findCandidates(catalog: MenuCatalog, ing: DraftIngredient, rules: DietRules, allowed: (p: Product) => boolean, limit = 6): Promise<CandidateSet> {
  const byId = new Map<string, Hit>();
  for (const term of ing.searchTerms.slice(0, 4)) {
    for (const h of await catalog.search(term, 25)) {
      const prev = byId.get(h.product.id);
      if (!prev || prev.score < h.score) byId.set(h.product.id, h);
    }
  }
  const hits = [...byId.values()].sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
  const rejected: Rejected[] = [];
  const reject = (p: Product, reason: string) => rejected.push({ productId: p.id, name: p.name, reason });

  // The category family most of the best text matches share is what the ingredient is (potatoes, not potato bread).
  const top = hits.slice(0, 8);
  const mass = new Map<string, number>();
  for (const h of top) mass.set(familyOf(h.product), (mass.get(familyOf(h.product)) ?? 0) + h.score);
  const family = [...mass.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const head = fold(ing.searchTerms[0] ?? ing.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  // A word the model says to avoid that its own search terms contain ("laktoosi" for lactose-free cream) is a
  // contradiction in the draft: ignored, or it would throw out every right product.
  const own = ` ${fold([ing.name, ...ing.searchTerms].join(" "))} `;
  const avoid = ing.avoid.map(fold).filter((w) => w && !own.includes(w));

  const out: Candidate[] = [];
  for (const h of hits) {
    const p = h.product;
    const n = names(p);
    const bad = avoid.find((w) => n.includes(w));
    if (bad) {
      reject(p, `"${bad}" in the name: wrong for this use (${ing.role})`);
      continue;
    }
    if (!allowed(p)) {
      reject(p, `category ${p.category} is not in the mandate`);
      continue;
    }
    if (!usableMeasure(ing, p)) {
      reject(p, `sold in a measure the ${ing.perCover.unit} amount cannot be converted to without guessing`);
      continue;
    }
    const dose = stockMismatch(ing, p);
    if (dose) {
      reject(p, dose);
      continue;
    }
    const prepared = PREPARED.find((w) => hasWord(n, w) && !head.some((t) => t.includes(w)) && !fold(ing.name).includes(w));
    if (prepared) {
      reject(p, `"${prepared}" in the name: a prepared product, not the ingredient`);
      continue;
    }
    const safety = checkSafety(p, rules);
    if (safety.verdict === "block") {
      reject(p, safety.checks.filter((c) => c.verdict === "block").map((c) => c.reason).join("; "));
      continue;
    }
    let score = h.score;
    const why: string[] = [];
    if (family && familyOf(p) !== family) {
      score *= 0.55;
      why.push("another product group than the best matches");
    }
    if (head.length && !head.some((t) => n.includes(t))) {
      score *= 0.7;
      why.push(`name does not say "${ing.searchTerms[0]}"`);
    }
    // Form, from the storage temperature the partner records (dried dill is ambient, fresh dill chilled) and the name.
    const t = p.temperatureClass;
    if (ing.form === "fresh" && t === "ambient" && familyOf(p) !== "174" && !(p.kinds ?? []).length && /^22/.test(p.categoryCode ?? "")) {
      // Dried herbs and spices for a fresh one: a different amount altogether, so not the same line. The fix step
      // can propose it with its own amount (dried dill is about a third of fresh).
      reject(p, "dried, not fresh: it takes a different amount, so it is offered only as a proposal");
      continue;
    }
    const ingText = ` ${fold([ing.name, ...ing.searchTerms].join(" "))} `;
    const variety = VARIETY.find((w) => hasWord(n, w) && !hasWord(ingText, w));
    if (variety) {
      score *= 0.8;
      why.push(`a variety (${variety}) the dish did not ask for`);
    }
    if (ing.form === "fresh" && (t === "frozen" || hasWord(n, "pakaste"))) {
      score *= 0.5;
      why.push("frozen, not fresh");
    } else if (ing.form === "fresh" && t === "ambient" && (family === "174" || family === "187") && familyOf(p) !== "174") {
      score *= 0.55;
      why.push("kept at room temperature: dried or preserved, not fresh");
    } else if (ing.form === "frozen" && t && t !== "frozen") {
      score *= 0.75;
      why.push("not frozen");
    } else if ((ing.form === "dried" || ing.form === "canned_or_jarred") && (t === "chilled" || t === "frozen")) {
      score *= 0.7;
      why.push(`${t}, not ${ing.form.replace(/_/g, " ")}`);
    } else if (ing.form !== "any" && FORM_WORDS[ing.form]?.some((w) => n.includes(w))) score *= 1.1;
    if (p.allergenInfo?.declared && rules.forbiddenAllergens.length) score *= 1.05; // an allergen rule: documented products first
    if (safety.verdict === "hold") {
      score *= 0.6;
      why.push("allergen data does not show it is safe");
    }
    if ((p.kinds ?? []).length) score *= 0.8;
    out.push({ product: p, score: Math.round(score * 1000) / 1000, safety, why });
  }
  out.sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length || a.product.id.localeCompare(b.product.id));
  return { candidates: out.slice(0, limit), rejected: rejected.slice(0, 12), searched: ing.searchTerms.slice(0, 4) };
}
