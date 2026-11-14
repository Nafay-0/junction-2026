/**
 * The dependency slot through which the core asks "what can stand in for this product, in this use?". The core
 * never imports the server: the server wires it to the product knowledge map (server/knowledge/service.ts), which
 * ranks substitutes by kitchen use with a reason, keeps pack sizes of the same line apart, and returns nothing,
 * with the reason, when no good alternative exists.
 *
 * The map only proposes. The kitchen's hard rules (mandate, request, stated and remembered rules) and the gate still
 * decide: a proposed product is offered only if it passes every one of them, and the gate checks the order as ever.
 */

export type AlternativeTier = "best" | "better" | "good";

export type ProposedAlternative = {
  productId: string;
  tier: AlternativeTier;
  /** One short factual sentence a buyer can read: "Same kind (cooking cream); fat 15 % -> 10 %; still lactose-free." */
  reason: string;
  /** The same product line in other pack sizes. */
  otherPacks: string[];
};

export type AlternativesAnswer = {
  /** Ranked best first; never padded. */
  substitutes: ProposedAlternative[];
  /** The same product in other pack sizes (not a substitute). */
  packAlternatives: string[];
  /** Set when there is no good alternative: why, in plain words. Shown as is. */
  none?: string;
  /** The kitchen use the ranking was made for ("sauce", "coffee", ...), when known. */
  use?: string;
};

export type AlternativesQuery = {
  /** Free text the use can be read from (the buyer's words, a dish). */
  text?: string;
  requiredClaims: string[];
  forbiddenAllergens: string[];
};

/** `undefined`: the source does not know the product (or is not loaded): callers keep their own rules. */
export type AlternativesSource = (productId: string, q: AlternativesQuery) => Promise<AlternativesAnswer | undefined>;

const TIER_ORDER: Record<AlternativeTier, number> = { best: 0, better: 1, good: 2 };
export const tierRank = (t: AlternativeTier | undefined) => (t ? TIER_ORDER[t] : 3);

/** Every product the answer proposes (substitutes and their other packs), for a short list. */
export function proposedIds(a: AlternativesAnswer | undefined, max = 3): string[] {
  if (!a) return [];
  return [...new Set(a.substitutes.slice(0, max).flatMap((s) => [s.productId, ...s.otherPacks.slice(0, 1)]))];
}

/** The proposal for one product id (a substitute or one of its other packs). */
export function proposalFor(a: AlternativesAnswer | undefined, productId: string): ProposedAlternative | undefined {
  return a?.substitutes.find((s) => s.productId === productId || s.otherPacks.includes(productId));
}
