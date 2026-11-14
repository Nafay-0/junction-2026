import { hasAllergen } from "./vocabulary";

/**
 * When a product meets a dietary requirement ("always lactose-free"), and on what evidence. A claim the maker states
 * is one way; it is not the only one. Lactose comes only from milk, so an olive oil whose maker declares its allergens
 * and lists no milk is lactose-free, label or not. The same holds for every claim that is the absence of an allergen
 * the law makes a maker declare (egg-free, soy-free, wheat-free, gluten-free); it does not hold for claims that are
 * not about allergens (organic, vegetarian, a fat content), and vegan stays claim-only: a declaration with no milk,
 * egg, fish, crustaceans or molluscs still says nothing of meat, gelatine, honey or carmine.
 *
 * The ways a requirement is met, each recorded as its own kind so the steps, the gate's record and the audit say which:
 *   claim        the maker states the claim
 *   declaration  the maker's allergen declaration is present and lists none of the allergens, "may contain" included
 *   nature       whole fresh produce (core/catalog/nature.ts), whose maker sent no declaration: it contains what it is
 *   ingredients  lactose only: no allergen declaration, but the maker's ingredient list is there, whole, and names no
 *                milk ingredient in English, Finnish or Swedish (a truffle oil: "extra virgin olive oil, black truffle
 *                aroma"). Lactose is an intolerance, not an allergy: it comes from the milk a recipe lists, not from
 *                traces, so the list settles it. Egg, soy, wheat and gluten are allergies, where an undeclared trace
 *                matters, so for them an ingredient list is not enough and only a declaration counts.
 *   not_food     a cleaning, hygiene, disposable or equipment product: a kitchen's dietary rule does not speak of it
 *                (only for a standing rule, `rule: true`; never for the buyer's own words in a search)
 * It is not met when the declaration lists the allergen (milk, without a lactose-free claim), and it is unknown, so
 * not met, when a food product has neither the claim nor a declaration.
 *
 * Strict evidence (mandate `allergenEvidence: "declared"`) is about the maker's allergen data: the declaration counts
 * (the maker's own statement, the same one a forbidden allergen is checked against); "by its nature" and a reading
 * of the ingredient list do not. Pure.
 */

export type ClaimEvidenceKind = "claim" | "declaration" | "nature" | "ingredients" | "not_food";
export type ClaimShortfall = "declared_present" | "listed_in_ingredients" | "no_declaration" | "claim_only" | "nature_not_accepted";
export type ClaimEvidence = { claim: string; met: true; kind: ClaimEvidenceKind } | { claim: string; met: false; why: ClaimShortfall; allergens?: string[] };

/** What a product's data says, in the shape every caller can give: an index record, a product, a signed quote line. */
export type ClaimSubject = {
  claims: readonly string[];
  /** The partner's numeric category code, or Dock's category slug ("cat_63210", "milk"). */
  category: string;
  /** False when the maker sent no allergen declaration at all; undefined means declared (the seed's products). */
  declared?: boolean;
  /** What the declaration says it contains or may contain. */
  present: readonly string[];
  /** Whole fresh produce without a declaration: what it contains by its nature. */
  byNature?: { allergens: readonly string[] };
  /** The maker's ingredient list, whole (never a shortened one), in any of its languages. */
  ingredients?: string;
};

/** For each claim that is the absence of declared allergens: the allergens whose absence makes it. */
const DERIVABLE: Record<string, string[]> = {
  lactose_free: ["milk", "lactose"],
  low_lactose: ["milk", "lactose"],
  egg_free: ["eggs"],
  soy_free: ["soy"],
  wheat_free: ["wheat"],
  // Oats are the one cereal the law lets a gluten-free claim carry; without the claim, oats are a cross-contact risk.
  gluten_free: ["gluten", "oats"],
};

export const DERIVABLE_CLAIMS: readonly string[] = Object.keys(DERIVABLE);

/** The shop's departments that are not food (kitchen equipment, household, cleaning, disposables, gases, office). */
const NON_FOOD_DEPARTMENTS = new Set(["20", "30", "32", "63", "64", "77", "90"]);

export function isNonFood(category: string): boolean {
  const code = /^(?:cat_)?(\d{5})$/.exec(category.trim())?.[1];
  return !!code && NON_FOOD_DEPARTMENTS.has(code.slice(0, 2));
}

function found(present: readonly string[], claims: readonly string[], allergens: string[]): string[] {
  const hit = allergens.filter((a) => (a === "oats" ? present.some((x) => x === "oats") : hasAllergen({ present, claims }, a)));
  // Milk is where lactose comes from: name the milk, not the lactose it implies.
  return hit.includes("milk") ? hit.filter((a) => a !== "lactose") : hit;
}

/** Whether, and how, a product meets one required claim. */
/**
 * `rule`: the claim is a kitchen's standing rule (its mandate, its stated rules), which does not speak of products
 * that are not food: a detergent meets "always lactose-free". A claim in the buyer's own words describes the thing
 * they want ("gluten-free lasagne sheets"), so a lasagne spatula never meets it.
 */
export function claimEvidence(p: ClaimSubject, claim: string, opts: { strict?: boolean; rule?: boolean } = {}): ClaimEvidence {
  if (p.claims.includes(claim)) return { claim, met: true, kind: "claim" };
  if (isNonFood(p.category)) return opts.rule ? { claim, met: true, kind: "not_food" } : { claim, met: false, why: "claim_only" };
  const from = DERIVABLE[claim];
  if (!from) return { claim, met: false, why: "claim_only" };
  if (p.declared !== false) {
    // Only the declaration's own words: a lactose-free claim already returned above, so milk here is lactose.
    const hit = found(p.present, [], from);
    return hit.length ? { claim, met: false, why: "declared_present", allergens: hit } : { claim, met: true, kind: "declaration" };
  }
  if (p.byNature) {
    if (opts.strict) return { claim, met: false, why: "nature_not_accepted" };
    const hit = found(p.byNature.allergens, [], from);
    return hit.length ? { claim, met: false, why: "declared_present", allergens: hit } : { claim, met: true, kind: "nature" };
  }
  if (!opts.strict && (claim === "lactose_free" || claim === "low_lactose") && p.ingredients?.trim()) {
    return MILK_WORDS.test(` ${fold(p.ingredients)} `.replace(NOT_MILK, " ")) ? { claim, met: false, why: "listed_in_ingredients", allergens: ["milk"] } : { claim, met: true, kind: "ingredients" };
  }
  return { claim, met: false, why: "no_declaration" };
}

const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ");
/** Plant "milks" and "butters" that carry no milk: taken out before the milk words are looked for. */
const NOT_MILK = / (cocoa|cacao|shea|peanut|nut|almond|coconut|oat|soy|soya|rice|kaakao|shea|maapahkina|pahkina|manteli|kookos|kaura|soija|riisi|kakao|jordnots|nots|mandel|kokos|havre|soja|ris) ?(butter|milk|cream|drink|voi|maito|kerma|juoma|smor|mjolk|gradde|dryck)/g;

/**
 * Milk ingredients, at the start of a word (Finnish and Swedish compound them: "kermajauhe", "vasslepulver"). It errs
 * towards seeing milk: a word that only looks like one ("voimakas") refuses a product, it never lets one through.
 */
const MILK_WORDS = new RegExp(
  ` (${[
    "milk", "cream", "butter", "whey", "lactose", "casein", "cheese", "yoghurt", "yogurt", "curd", "ghee", "quark", "kefir", "dairy", "skyr", "lactic? ferment", "lactalbumin", "lactoglobulin",
    "maito", "maidon", "kerma", "voi", "hera", "laktoosi", "kaseiini", "kaseinaatti", "juusto", "jogurtti", "rahka", "piima", "kefiiri", "viili", "ternimaito",
    "mjolk", "gradde", "smor", "vassle", "laktos", "kasein", "ost", "kvarg", "filmjolk",
  ].join("|")})`,
);

/** Every required claim, the unmet ones first. */
export function claimsEvidence(p: ClaimSubject, claims: readonly string[], opts: { strict?: boolean; rule?: boolean } = {}): ClaimEvidence[] {
  return claims.map((c) => claimEvidence(p, c, opts)).sort((a, b) => Number(a.met) - Number(b.met));
}

const word = (c: string) => c.replaceAll("_", "-");
const allergenWord = (a: string) => a.replace(/^gs1:/, "allergen code ").replaceAll("_", " ");

/** How a requirement was met, in English, for the gate's record and the ledger: "no milk in the maker's allergen declaration". */
export function evidenceText(e: Extract<ClaimEvidence, { met: true }>): string {
  const what = (DERIVABLE[e.claim] ?? []).filter((a) => a !== "lactose").map(allergenWord).join(" or ");
  if (e.kind === "claim") return `the maker states it is ${word(e.claim)}`;
  if (e.kind === "declaration") return `no ${what} in the maker's allergen declaration`;
  if (e.kind === "nature") return `fresh, whole produce: no ${what} by its nature, not declared by the maker`;
  if (e.kind === "ingredients") return "no milk in the maker's ingredient list (it sent no allergen declaration)";
  return "not food, so a dietary rule does not apply to it";
}

/** Why a requirement is not met, in English: "its allergen declaration lists milk and it carries no lactose-free claim". */
export function shortfallText(e: Extract<ClaimEvidence, { met: false }>): string {
  const c = word(e.claim);
  if (e.why === "declared_present") return `not ${c}: its allergen declaration lists ${(e.allergens ?? []).map(allergenWord).join(", ")} and it carries no ${c} claim`;
  if (e.why === "listed_in_ingredients") return `not ${c}: its ingredient list names milk and it carries no ${c} claim`;
  if (e.why === "no_declaration") return `not shown to be ${c}: no ${c} claim and no allergen declaration from its maker, so it is unknown`;
  if (e.why === "nature_not_accepted") return `not shown to be ${c}: fresh produce without a maker's declaration, and the kitchen accepts declared data only`;
  return `not ${c}: its maker does not state it`;
}

// ---------- adapters ----------

/** A Dock product (core/catalog.ts): its allergen evidence when the partner's data has it, else the seed's list. */
export function subjectOfProduct(p: { claims?: never; attributes: readonly string[]; category: string; categoryCode?: string; allergens: readonly string[]; allergenInfo?: { declared: boolean; contains: readonly string[]; mayContain: readonly string[]; byNature?: { allergens: readonly string[] } }; texts?: { ingredients?: { en?: string; fi?: string } } }): ClaimSubject {
  const a = p.allergenInfo;
  const ing = wholeIngredients(p.texts?.ingredients);
  return {
    ...(ing ? { ingredients: ing } : {}),
    claims: p.attributes,
    category: p.categoryCode ?? p.category,
    declared: a ? a.declared : undefined,
    present: a ? [...a.contains, ...a.mayContain] : p.allergens,
    ...(a?.byNature ? { byNature: a.byNature } : {}),
  };
}

/**
 * The maker's ingredient list as evidence: every language given, joined, but only when none was shortened in the
 * index (a cut list cannot show what is not in it).
 */
export function wholeIngredients(t: { en?: string; fi?: string } | undefined): string | undefined {
  const xs = [t?.en, t?.fi].filter((x): x is string => !!x?.trim());
  return xs.length && xs.every((x) => !x.endsWith("…")) ? xs.join(" | ") : undefined;
}

/** A signed quote line (core/quote.ts): the facts it carries. */
export function subjectOfLine(l: { attributes: readonly string[]; category: string; allergens: readonly string[]; allergensDeclared?: boolean; allergensByNature?: { allergens: readonly string[] }; ingredients?: string }): ClaimSubject {
  return {
    ...(l.ingredients ? { ingredients: l.ingredients } : {}),
    claims: l.attributes,
    category: l.category,
    declared: l.allergensDeclared,
    // A line without a declaration lists its by-nature allergens; with one, its declared ones.
    present: l.allergensDeclared === false ? [] : l.allergens,
    ...(l.allergensByNature ? { byNature: l.allergensByNature } : {}),
  };
}
