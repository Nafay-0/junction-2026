import type { IndexedProduct } from "./partner";
import { fold, tokenize } from "./search";

/**
 * Allergens by a product's nature. "Unknown is never safe" is right for a ready meal and wrong for an onion: a
 * fresh, whole, single-ingredient vegetable, fruit or herb whose maker sent no allergen data contains what it is
 * itself and nothing else (celeriac is celery; an onion is no nut). This module makes that exception, narrowly:
 *
 *   - the partner files it under fresh produce (category codes 174xx),
 *   - the product knowledge map profiles it as a vegetable, fruit or berry, herb or potato, in whole form, fresh,
 *   - the data's storage class is not frozen,
 *   - its names say nothing of processing, cutting, mixing or coating (mix, peeled, sliced, puree, marinated, ...).
 *
 * Anything else stays unknown and refused. The evidence is always "by its nature, not declared by the maker", never
 * the maker's declaration, and a kitchen whose mandate asks for declared allergen data only keeps the strict rule
 * (mandate `allergenEvidence: "declared"`). The knowledge map lives on the server: the server registers a lookup of
 * its profiles (registerNatureProfiles); without one, nothing is taken by nature.
 */

export const NATURE_BASIS = "by its nature, not declared by the maker";

export type NatureProfile = { family: string; form: string; state: string; kindLabel: string };
export type NatureEvidence = { allergens: string[]; basis: string };

const PRODUCE_FAMILIES = new Set(["vegetable", "fruit_berry", "herb_spice", "potato"]);

/** Words in a name that make it processed, cut, mixed, coated or prepared, in English, Finnish and Swedish (folded). */
const PROCESSED =
  /(mix|mixed|sekoitus|seos|blandning|blend|peeled|kuorittu|kuoritut|skalad|sliced|viipal|skivad|diced|kuutio|tarning|strip|suikale|grated|raaste|riven|shredded|puree|sose|pure|mash|muusi|survos|marin|pickl|etikka|sailyke|canned|tinned|conserv|cooked|kypsa|keitetty|boiled|fried|paistettu|roasted|paahdettu|grilled|grillattu|dried|kuivattu|torkad|frozen|pakaste|fryst|iqf|soup|keitto|sauce|kastike|salad mix|salaattisekoitus|coated|leivitetty|breaded|juice|mehu|smoothie|chips|crisps|snack|valmis|ready|prepared|seasoned|maustettu|kryddad| ja | and | och | & |\+)/;

/** Allergens that are produce themselves: what a fresh whole product of that kind contains by its nature. */
const ALLERGEN_PRODUCE: [string, RegExp][] = [
  ["celery", /(celery|celeriac|selleri|mukulaselleri|varsiselleri|rotselleri|blekselleri)/],
  ["mustard", /(mustard|sinappi|senap)/],
  ["nuts", /(almond|manteli|mandel|hazelnut|hasselpahkina|hasselnot|walnut|saksanpahkina|valnot|cashew|pecan|pistach|macadamia|brazil nut|chestnut|kastanja)/],
  ["peanuts", /(peanut|maapahkina|jordnot)/],
  ["sesame", /(sesame|seesami|sesam)/],
  ["lupin", /(lupin|lupiini|lupin)/],
];

/** What a fresh whole product contains by its nature, or undefined when the exception does not apply. */
export function allergensByNature(p: IndexedProduct, profile: NatureProfile | undefined): NatureEvidence | undefined {
  if (p.allergens.declared || !profile) return undefined;
  if (!p.categoryCode.startsWith("174")) return undefined;
  if (!PRODUCE_FAMILIES.has(profile.family) || profile.form !== "whole" || profile.state !== "fresh") return undefined;
  if (p.temperature.class === "frozen") return undefined;
  const names = ` ${[p.names.en, p.names.fi, p.names.sv].filter(Boolean).map((n) => fold(n!)).join(" | ")} `;
  if (PROCESSED.test(names)) return undefined;
  const text = `${names} ${fold(profile.kindLabel)} ${tokenize(profile.kindLabel).join(" ")}`;
  const allergens = ALLERGEN_PRODUCE.filter(([, re]) => re.test(text)).map(([a]) => a);
  return { allergens, basis: `${profile.kindLabel}, fresh and whole: ${NATURE_BASIS}` };
}

// ---------- the server's lookup ----------

const g = globalThis as typeof globalThis & { __dockNature?: (id: string) => NatureProfile | undefined };

/** The server registers the knowledge map's profiles here once the map is loaded (null removes it, for tests). */
export function registerNatureProfiles(lookup: ((id: string) => NatureProfile | undefined) | null): void {
  g.__dockNature = lookup ?? undefined;
}

/** The exception for an index record, with the registered profiles. */
export function natureOf(p: IndexedProduct): NatureEvidence | undefined {
  return g.__dockNature ? allergensByNature(p, g.__dockNature(p.id)) : undefined;
}
