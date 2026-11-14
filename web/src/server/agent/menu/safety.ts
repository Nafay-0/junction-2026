import type { Product } from "@/core/catalog";
import { allergenOf, hasAllergen } from "@/core/vocabulary";

/**
 * Is a product safe for a kitchen's dietary rules? Plain code over the partner's allergen and claim data, with
 * three outcomes, and "unknown" never read as "free from":
 *
 *   ok     the data shows the rule is met (declared allergens without the forbidden one, or the claim itself)
 *   hold   the data cannot show it: a person must check the product before it is ordered
 *   block  the data shows it breaks the rule (contains, may contain), or the gate would refuse it anyway
 *
 * A forbidden allergen is strict: "may contain" blocks, and a product with no allergen data is held, or blocked
 * when the mandate itself forbids the allergen (the gate refuses unknown allergen data then; see core/policy.ts).
 * Dietary claims (lactose-free, gluten-free, vegan) are read from what the product must not contain: a raw
 * vegetable or a fresh fish fillet with no allergen data is not held for lactose, but a sauce is.
 */

export type SafetyVerdict = "ok" | "hold" | "block";
export type SafetyCheck = { rule: string; verdict: SafetyVerdict; reason: string };
export type Safety = { verdict: SafetyVerdict; checks: SafetyCheck[] };

export type DietRules = {
  /** Allergens no line may contain or "may contain"; source says where each rule came from. */
  forbiddenAllergens: { allergen: string; source: string }[];
  /** Claims every line must meet where they apply (lactose_free, gluten_free, vegan, vegetarian). */
  requiredClaims: { claim: string; source: string }[];
  /** Allergens the mandate forbids: for these the gate refuses a product without allergen data. */
  mandateAllergens: string[];
  /** True when the mandate asks for the maker's allergen data only (no "by its nature" for fresh produce). */
  declaredOnly?: boolean;
};

/** Partner category families (first three digits) of raw single-ingredient food: fresh vegetables, fruit, fish and meat. */
const RAW_FAMILIES = new Set(["174", "187"]);
export const familyOf = (p: Product) => (p.categoryCode ?? "").slice(0, 3);
const isRaw = (p: Product) => RAW_FAMILIES.has(familyOf(p));
const isDairy = (p: Product) => (p.categoryCode ?? "").startsWith("10") || ["milk", "cream", "yoghurt", "butter", "sour_cream", "quark", "fermented_milk", "milk_powder", "condensed_milk"].includes(p.category);
const isMeatOrFish = (p: Product) => familyOf(p) === "187" || /^(172|1720|1721|4170|4171|4172)/.test(p.categoryCode ?? "");

const ALLERGEN_TEXT: Record<string, string> = { nuts: "nuts", peanuts: "peanuts", milk: "milk", gluten: "gluten", eggs: "eggs", fish: "fish", lactose: "lactose" };
const text = (a: string) => ALLERGEN_TEXT[a] ?? a.replace(/_/g, " ");

function info(p: Product) {
  // Seed products carry no allergenInfo; their `allergens` list is complete by construction.
  return p.allergenInfo ?? { declared: true, contains: p.allergens, mayContain: [], freeFrom: [] };
}

/** What a claim forbids the product to contain. */
const CLAIM_EXCLUDES: Record<string, string[]> = {
  lactose_free: ["lactose"],
  gluten_free: ["gluten"],
  vegan: ["milk", "eggs", "fish", "crustaceans", "molluscs"],
  vegetarian: ["fish", "crustaceans", "molluscs"],
};

export function checkSafety(p: Product, rules: DietRules): Safety {
  const a = info(p);
  const checks: SafetyCheck[] = [];
  for (const { allergen, source } of rules.forbiddenAllergens) {
    const rule = `no ${text(allergen)} (${source})`;
    // One vocabulary with the gate (core/vocabulary.ts): a hazelnut is a nut, milk without the claim carries lactose.
    if (hasAllergen({ present: a.contains, claims: p.attributes }, allergen)) checks.push({ rule, verdict: "block", reason: `contains ${text(allergen)}` });
    else if (hasAllergen({ present: a.mayContain, claims: p.attributes }, allergen)) checks.push({ rule, verdict: "block", reason: `may contain ${text(allergen)}` });
    else if (!a.declared && a.byNature && !rules.declaredOnly) {
      // Fresh, whole produce: what it contains by its nature (core/catalog/nature.ts), never the maker's declaration.
      if (hasAllergen({ present: a.byNature.allergens, claims: p.attributes }, allergen)) checks.push({ rule, verdict: "block", reason: `contains ${text(allergen)} by its nature` });
      else checks.push({ rule, verdict: "ok", reason: `no ${text(allergen)} ${a.byNature.basis.split(": ").pop()} (${a.byNature.basis.split(":")[0]})` });
    } else if (!a.declared) {
      const gate = rules.mandateAllergens.includes(allergen);
      checks.push({
        rule,
        verdict: gate ? "block" : "hold",
        reason: gate ? `no allergen data from its maker; the mandate forbids ${text(allergen)}, so the gate refuses unknown data` : `no allergen data from its maker, so nothing shows it is free of ${text(allergen)}`,
      });
    } else checks.push({ rule, verdict: "ok", reason: a.freeFrom.includes(allergen) ? `declared free from ${text(allergen)}` : `allergens declared, ${text(allergen)} not among them` });
  }
  for (const { claim, source } of rules.requiredClaims) {
    const rule = `${claim.replace(/_/g, "-")} (${source})`;
    if (p.attributes.includes(claim)) {
      checks.push({ rule, verdict: "ok", reason: `carries the ${claim.replace(/_/g, "-")} claim` });
      continue;
    }
    const excludes = CLAIM_EXCLUDES[claim];
    if (!excludes) {
      checks.push({ rule, verdict: "hold", reason: `does not carry the ${claim.replace(/_/g, "-")} claim` });
      continue;
    }
    // Lactose-free: a lactose-free claim or no milk at all. Milk-containing products without the claim break it.
    const bad = claim === "lactose_free" ? ["milk", "lactose"] : excludes;
    const found = bad.filter((x) => a.contains.includes(x));
    if (found.length) {
      checks.push({ rule, verdict: "block", reason: `contains ${found.map(text).join(" and ")} and is not ${claim.replace(/_/g, "-")}` });
      continue;
    }
    if ((claim === "vegan" || claim === "vegetarian") && isMeatOrFish(p)) {
      checks.push({ rule, verdict: "block", reason: "meat or fish" });
      continue;
    }
    if (a.declared) {
      const traces = bad.filter((x) => a.mayContain.includes(x));
      // Traces of milk do not break lactose-free cooking; traces of gluten do break gluten-free.
      if (traces.length && claim !== "lactose_free") checks.push({ rule, verdict: "block", reason: `may contain ${traces.map(text).join(" and ")}` });
      else checks.push({ rule, verdict: "ok", reason: `allergens declared, no ${bad.map(text).join(" or ")}` });
      continue;
    }
    if (isRaw(p) && !isDairy(p)) checks.push({ rule, verdict: "ok", reason: "a raw single-ingredient product (no allergen data, none expected)" });
    else checks.push({ rule, verdict: "hold", reason: `no allergen data, so nothing shows it is ${claim.replace(/_/g, "-")}` });
  }
  const verdict: SafetyVerdict = checks.some((c) => c.verdict === "block") ? "block" : checks.some((c) => c.verdict === "hold") ? "hold" : "ok";
  return { verdict, checks };
}

/** One sentence for a held or blocked product. */
export function safetyProblem(s: Safety): string {
  const bad = s.checks.filter((c) => c.verdict === s.verdict);
  return bad.map((c) => `${c.reason} (rule: ${c.rule})`).join("; ");
}

/**
 * The kitchen's rules plus what one request adds ("nut-free", "gluten-free" in the chef's words), never fewer: a
 * request can tighten the rules, not loosen them.
 */
export function withRequestRules(base: DietRules, request: { forbiddenAllergens?: readonly string[]; requiredClaims?: readonly string[] }): DietRules {
  const forbidden = [...base.forbiddenAllergens];
  for (const w of request.forbiddenAllergens ?? []) {
    const allergen = allergenOf(w) ?? w;
    if (!forbidden.some((f) => f.allergen === allergen)) forbidden.push({ allergen, source: "this request" });
  }
  const claims = [...base.requiredClaims];
  for (const c of request.requiredClaims ?? []) if (!claims.some((x) => x.claim === c)) claims.push({ claim: c, source: "this request" });
  if (forbidden.length === base.forbiddenAllergens.length && claims.length === base.requiredClaims.length) return base;
  return { ...base, forbiddenAllergens: forbidden, requiredClaims: claims };
}
