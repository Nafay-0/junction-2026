import { claimEvidence } from "@/core/claim-evidence";
import { subjectOfIndexed } from "@/core/catalog/search";
import type { IndexedProduct } from "@/core/catalog/partner";
import { forbiddenPresent, resolveConstraints } from "@/core/vocabulary";

/**
 * Hard facts, checked by code against the partner's data fields only. A relation the map serves has passed
 * `hardCheck`; nothing a model wrote is consulted here.
 *
 * Claims the buyer relies on. Every claim the buyer states is enforced. Without a statement, the original's own
 * dietary claims are assumed relied on: lactose-free, low-lactose, gluten-free, vegan, vegetarian. Two exceptions,
 * both because the data makes the claim carry no information:
 *   - "vegetarian" is not assumed for products that are vegetarian by nature (milk, cream, yoghurt, butter, ...),
 *     nor "vegan" for plant foods by nature (vegetables, fruit, juice, spices, flour, ...):
 *     one maker tags every dairy product vegetarian and another tags none, so requiring it would only refuse every
 *     other brand. It is still enforced for cheese (rennet), ready meals, sweets and anything else, and always when
 *     the buyer asks for it.
 *   - "egg-free", "soy-free", "wheat-free" are not assumed when both products declare allergen data: the allergen
 *     comparison below decides, and it is stricter than the claim.
 * lactose_free implies low_lactose and vegan implies vegetarian in the index; never the other way round. Organic is
 * a preference, not a dietary claim: the map reports it as a change.
 *
 * Allergens. The substitute introduces no allergen the original does not have. "Contains" where the original only
 * "may contain" counts as new. Milk that is not lactose-free carries lactose, whether or not a maker lists it.
 * When the original has allergen data and the substitute has none, it fails: missing data is unknown, not safe.
 * When neither has data, it passes as `unknown` and says so.
 *
 * Forbidden allergens from the buyer: the substitute must declare allergen data and not contain or may-contain any.
 */

export type BuyerConstraints = {
  /** Dietary claims the buyer requires (Dock slugs: lactose_free, gluten_free, vegan, ...). */
  requiredClaims?: string[];
  /** Allergens that must not be present or possible (milk, gluten, nuts, ...). */
  forbiddenAllergens?: string[];
};

/**
 * The buyer's words in the catalogue's terms (one vocabulary with the gate, core/vocabulary.ts): English, Finnish,
 * Swedish and GS1 forms. A word the data cannot speak about is returned in `unknown`: callers refuse it, because a
 * constraint nobody can check must never pass as "verified".
 */
export function resolveBuyer(buyer: BuyerConstraints | undefined): { constraints?: BuyerConstraints; unknown: { word: string; as: "claim" | "allergen" }[] } {
  if (!buyer) return { unknown: [] };
  const r = resolveConstraints(buyer);
  return { constraints: { requiredClaims: r.requiredClaims, forbiddenAllergens: r.forbiddenAllergens }, unknown: r.unknown };
}

export type AllergenEvidence = "verified" | "unknown";

export type HardCheck =
  | { ok: true; claimsKept: string[]; allergens: AllergenEvidence }
  | { ok: false; code: "claim_missing" | "allergen_new" | "allergen_unknown" | "allergen_forbidden"; reason: string };

/** Dietary claims a buyer may rely on without saying so. */
export const RELIED_CLAIMS = ["lactose_free", "low_lactose", "gluten_free", "vegan", "vegetarian", "egg_free", "soy_free", "wheat_free"] as const;
const RELIED = new Set<string>(RELIED_CLAIMS);
const COVERED_BY_ALLERGENS = new Set(["egg_free", "soy_free", "wheat_free"]);

export type CheckContext = {
  /** The original is vegetarian by nature (dairy): its "vegetarian" tag is not assumed relied on. */
  inherentlyVegetarian?: boolean;
  /** The original is a plant food by nature (vegetables, juice, spices): its "vegan" and "vegetarian" tags are not assumed relied on. */
  inherentlyVegan?: boolean;
};

/** The dietary claims of a product that a buyer may be relying on (for display). */
export function protectedClaims(p: IndexedProduct, ctx: CheckContext = {}): string[] {
  const implicit = (c: string) => (c === "vegetarian" && (ctx.inherentlyVegetarian || ctx.inherentlyVegan)) || (c === "vegan" && ctx.inherentlyVegan);
  return p.claims.filter((c) => RELIED.has(c) && !implicit(c)).sort();
}

const present = (p: IndexedProduct) => new Set([...p.allergens.contains, ...p.allergens.mayContain]);
const pretty = (s: string) => s.replace(/^gs1:/, "allergen code ").replace(/_/g, " ");

/** What the original contains, with lactose added for milk that is not lactose-free. */
function containsOf(p: IndexedProduct): Set<string> {
  const s = new Set(p.allergens.contains);
  if (s.has("milk") && !p.claims.includes("lactose_free")) s.add("lactose");
  return s;
}

export function hardCheck(original: IndexedProduct, candidate: IndexedProduct, buyer: BuyerConstraints = {}, ctx: CheckContext = {}): HardCheck {
  const bothDeclared = original.allergens.declared && candidate.allergens.declared;
  const assumed = protectedClaims(original, ctx).filter((c) => !(bothDeclared && COVERED_BY_ALLERGENS.has(c)));
  const needed = [...new Set([...assumed, ...(buyer.requiredClaims ?? [])])].sort();
  // The map stays strict on "by nature"; a claim its declaration shows (no milk: lactose-free) is kept like a stated one.
  const missing = needed.filter((c) => !claimEvidence(subjectOfIndexed(candidate), c, { strict: true }).met);
  if (missing.length) return { ok: false, code: "claim_missing", reason: `not ${missing.map(pretty).join(", ")} by its data` };

  const forbidden = buyer.forbiddenAllergens ?? [];
  if (forbidden.length) {
    if (!candidate.allergens.declared) return { ok: false, code: "allergen_unknown", reason: "has no allergen data, so a forbidden allergen cannot be ruled out" };
    const hit = forbiddenPresent({ present: [...present(candidate)], claims: candidate.claims }, forbidden);
    if (hit.length) return { ok: false, code: "allergen_forbidden", reason: `contains or may contain ${hit.map(pretty).join(", ")}` };
  }

  if (original.allergens.declared) {
    if (!candidate.allergens.declared) return { ok: false, code: "allergen_unknown", reason: "has no allergen data, the original has" };
    const origContains = containsOf(original);
    const origAny = new Set([...origContains, ...original.allergens.mayContain]);
    const newContains = candidate.allergens.contains.filter((a) => !origContains.has(a));
    const newMay = candidate.allergens.mayContain.filter((a) => !origAny.has(a));
    const fresh = [...new Set([...newContains, ...newMay])];
    if (fresh.length) return { ok: false, code: "allergen_new", reason: `adds ${fresh.map(pretty).join(", ")}` };
    return { ok: true, claimsKept: needed, allergens: "verified" };
  }
  return { ok: true, claimsKept: needed, allergens: "unknown" };
}

