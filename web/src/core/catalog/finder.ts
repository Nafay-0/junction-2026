import type { Product } from "../catalog";

/**
 * The port through which the core takes ranked candidates from smart search (server/search/). The core never calls a
 * model: whatever ranks the candidates (a relevance judge, semantic vectors, or plain lexical search when those are
 * off) lives behind this interface, and every hard rule (claims, allergens, the mandate's groups, the kitchen's
 * stated rules) is still applied by the core's own code to whatever comes back.
 */

/**
 * How a candidate relates to what was asked:
 *   exact    the kind of product asked for
 *   variant  that kind, in another variant than the words name (fat level, flavour, form, pack type)
 *   standin  a different kind that could do the job: shown as "instead", never as what was asked for
 *   other    not the kind asked for (left out of results)
 * Absent when no judge answered (the lexical ranking stands).
 */
export type MatchLabel = "exact" | "variant" | "standin" | "other";

export type FindRequest = {
  /** The buyer's own words. */
  text: string;
  /** What the request reader made of them, when there was a reader: the item's words, the family; `context` (a dish, a role, a form) is for the relevance judge only, not for recall. */
  need?: { itemText?: string; category?: string; context?: string };
  /** Claims every hit must carry (from the structured need or the page's filters). Added to what the words say. */
  requiredClaims?: string[];
  forbiddenAllergens?: string[];
  /** Rule out a forbidden allergen by the maker's data only (the mandate's allergenEvidence "declared"): no fresh produce by its nature. */
  declaredAllergensOnly?: boolean;
  /** A Dock category slug or partner code: only this family. */
  category?: string;
  /** Only among these products (a family already narrowed by the core's rules). */
  ids?: string[];
  limit?: number;
  /** Skip the judge (the caller only needs recall), e.g. a family lookup. */
  noJudge?: boolean;
  /** Skip semantic recall (no query embedding): lexical, typo, kinds and codes only, in a few milliseconds. */
  noVectors?: boolean;
};

export type FoundProduct = {
  product: Product;
  label?: MatchLabel;
  /** The judge's confidence in its label, 0..1. */
  confidence?: number;
  /** Where recall found it: lexical, typo, kind, vector, code, ... */
  sources: string[];
};

export type FindResult = {
  hits: FoundProduct[];
  /** Which path answered: the judge ranked the candidates, or the fused recall ranking stood (and why). */
  path: "judge" | "ranked" | "lexical";
  reason?: string;
  /** Requirements read from the words, in plain language ("read 'laktositon' as lactose-free"). */
  notes: string[];
  /** Claims and allergen rules that were applied (the union of the words and the request). */
  applied: { claims: string[]; forbiddenAllergens: string[]; brand?: string; pack?: { amount: number; unit: "L" | "kg" } };
  /** Nothing is the kind asked for, but something could stand in. */
  onlyStandins: boolean;
  /** Nothing in the assortment is the kind asked for, nor could stand in (judge's answer). */
  notSold: boolean;
  /** The judge was not sure of its top answer: ask, or show a wider set. */
  unsure: boolean;
  /** Candidates the judge saw, and the time and cost of the search. */
  stats: { candidates: number; ms: number; judgeMs?: number; embedMs?: number; tokens?: number; costUsd?: number };
};

export interface ProductFinder {
  find(req: FindRequest): Promise<FindResult>;
}
