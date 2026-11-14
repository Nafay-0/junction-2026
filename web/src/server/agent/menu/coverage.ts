import { isDefining } from "@/core/dish-rules";
import type { DraftDish } from "./draft";
import type { LineSpec, PlanLineView } from "./plan";

/**
 * How the plan covers every ingredient of every dish: built from the recipe first (every ingredient the dishes need,
 * refused dishes included), then one coverage given to each. Nothing is filtered out of the list: an ingredient that
 * is not bought is in it with a stable code and words saying why.
 *
 *   ordered   bought: product and packs
 *   on_hand   the kitchen has it (what the chef said, or an estimate from its own history), with the basis
 *   staple    on the kitchen's list of staples it always keeps: assumed, not bought (said, never silent)
 *   swapped   bought as another product than the ingredient (onion powder for fresh onion), with what for and why
 *   not_covered   not bought, with the reason as a code:
 *       outside_groups   the product groups the kitchen's mandate covers do not include it (the group named, and theirs)
 *       rule             a rule forbids it (the rule and its source): an allergen, a diet, a stated rule, nutrition
 *       cannot_arrive    no product can come by the day (the earliest day when the wholesaler names one)
 *       not_sold         the assortment has nothing that is it
 *       not_priced       no live price yet
 *       needs_covers     no number of covers yet: no amount
 *       struck_by_buyer  the buyer took it off
 *       refused_dish     its dish is refused under a rule
 *       needs_decision   a product is found but a person must decide first (an unusual amount, another form)
 */

export type CoverageStatus = "ordered" | "on_hand" | "staple" | "swapped" | "not_covered";
export type CoverageCode = "outside_groups" | "rule" | "cannot_arrive" | "not_sold" | "not_priced" | "needs_covers" | "struck_by_buyer" | "refused_dish" | "needs_decision";

export type Coverage = {
  dishId: string;
  dish: string;
  /** The recipe's own word for it (English), and the Finnish search word the planner gave (the trade's word). */
  ingredient: string;
  ingredientFi: string | null;
  lineId: string | null;
  /** What the covers need, as worked out ("4,8 l"); null without covers. */
  need: string | null;
  status: CoverageStatus;
  code?: CoverageCode;
  /** Why, in words (English, for the steps and the conversation's grounding). */
  words: string;
  detail?: { product?: string; packs?: number; totalCents?: number; deliveryDate?: string; group?: string; kitchenGroups?: string[]; rule?: { text: string; source: string }; earliest?: string; insteadOf?: string };
  /** What the dish is made of (the meat in meatballs, the fish in a fish soup, the potatoes in mash). */
  defining: boolean;
};

export type Completeness = {
  coverage: Coverage[];
  /** Every ingredient of every planned dish is ordered, on hand, a staple, or swapped (said). */
  complete: boolean;
  ingredients: number;
  covered: number;
  missing: Coverage[];
  /** A dish's defining ingredient is among what is not covered: the plan is not the dish. */
  definingMissing: boolean;
};

const DATA = { departments: {} as Record<string, string>, categories: {} as Record<string, { label: string }> };
/** Group names, set once by the service from the catalogue's labels (server/catalog-categories.json). */
export function setGroupLabels(d: { departments: Record<string, string>; categories: Record<string, { label: string }> }): void {
  DATA.departments = d.departments;
  DATA.categories = d.categories;
}
/** "Meat and fish: minced meat" for a category slug like cat_18760. */
export function groupName(slug: string, codeOf: (slug: string) => string | undefined = (s) => /^cat_(\d+)$/.exec(s)?.[1]): string {
  const code = codeOf(slug);
  if (!code) return slug.replace(/_/g, " ");
  const dept = DATA.departments[code.slice(0, 2)];
  const cat = DATA.categories[code]?.label;
  return [dept, cat].filter(Boolean).join(": ") || `group ${code}`;
}
/** The departments a mandate's product groups fall in, by name ("Dairy and cheese", "Fresh bakery"). */
export function kitchenGroups(allowed: readonly string[], codeOf: (slug: string) => string | undefined): string[] {
  return [...new Set(allowed.map((s) => codeOf(s)?.slice(0, 2)).filter((x): x is string => !!x).map((d) => DATA.departments[d] ?? `group ${d}`))].sort();
}

const OUTSIDE = /category (\S+) is not in the mandate/;
const plain = (t: string) => t.replace(/\s*\(searched:[^)]*\)/g, "").trim();

/** One coverage for one ingredient's line, from what the plan made of it. */
function lineCoverage(l: PlanLineView | undefined, owner: PlanLineView | undefined, spec: LineSpec, ctx: Ctx): Pick<Coverage, "status" | "code" | "words" | "detail"> {
  const v = owner ?? l;
  if (!v) return { status: "not_covered", code: "not_sold", words: "not planned" };
  if (v.status === "needs_covers") return { status: "not_covered", code: "needs_covers", words: "give the number of covers to work out the amount" };
  if (v.status === "struck") {
    if (v.onHand) return { status: "on_hand", words: v.onHand.text, detail: {} };
    if (spec.pantry && !ctx.struckByBuyer(spec.lineId)) return { status: "staple", words: "a staple the kitchen keeps (its list of staples): assumed, not bought" };
    return { status: "not_covered", code: "struck_by_buyer", words: v.struckReason ?? "taken off by the buyer" };
  }
  const outside = v.excluded.map((e) => OUTSIDE.exec(e.reason)?.[1]).filter((x): x is string => !!x);
  const open = v.doubts.filter((d) => !d.accepted);
  if (v.chosen) {
    const product = v.chosen.products.map((x) => x.name).join(" + ");
    const detail = { product, packs: v.chosen.products.reduce((s, x) => s + x.packs, 0), totalCents: v.chosen.totalCents, deliveryDate: v.chosen.deliveryDate };
    const otherForm = open.find((d) => d.kind === "different_form");
    // Bought as another kind of product because the thing itself is outside the kitchen's groups (onion powder for onion).
    const chosenCode = ctx.codeOfProduct(v.chosen.products[0].productId);
    const swappedFrom = outside.find((slug) => { const c = ctx.codeOf(slug); return !!c && !!chosenCode && c.slice(0, 2) !== chosenCode.slice(0, 2); });
    if (swappedFrom) return { status: "swapped", words: `${product} instead: ${spec.name} itself is in ${groupName(swappedFrom, ctx.codeOf)}, which your product groups do not cover`, detail: { ...detail, insteadOf: spec.name, group: groupName(swappedFrom, ctx.codeOf), kitchenGroups: ctx.kitchenGroups } };
    if (otherForm) return { status: "swapped", words: plain(otherForm.text), detail: { ...detail, insteadOf: spec.name } };
    // A product whose data cannot show the kitchen's rule is met (no allergen data under "always lactose-free"): the
    // gate would refuse it, so it is not covered, named with the product and the rule.
    const unknown = open.find((d) => d.kind === "allergen_unknown");
    if (unknown) return { status: "not_covered", code: "rule", words: plain(unknown.text).replace(/ A person must check the product before it is ordered\.$/, ""), detail: { ...detail, ...(ctx.ruleOf(v) ? { rule: ctx.ruleOf(v)! } : {}) } };
    if (open.some((d) => !d.acceptLabel)) return { status: "not_covered", code: "needs_decision", words: plain(open.find((d) => !d.acceptLabel)!.text), detail };
    return { status: "ordered", words: v.chosen.products.map((x) => `${x.packText} ${x.name}`).join(" + "), detail };
  }
  const late = open.find((d) => d.kind === "cannot_arrive");
  if (late) return { status: "not_covered", code: "cannot_arrive", words: plain(late.text), ...(ctx.earliest(v) ? { detail: { earliest: ctx.earliest(v) } } : {}) };
  const unsafe = open.find((d) => d.kind === "no_safe_product" || d.kind === "rule_conflict");
  if (unsafe) return { status: "not_covered", code: "rule", words: plain(unsafe.text), detail: { ...(ctx.ruleOf(v) ? { rule: ctx.ruleOf(v)! } : {}) } };
  if (outside.length) {
    const group = groupName(outside[0], ctx.codeOf);
    return { status: "not_covered", code: "outside_groups", words: `${spec.name} is in ${group}, which your product groups do not cover (they cover ${ctx.kitchenGroups.join(", ") || "none"})`, detail: { group, kitchenGroups: ctx.kitchenGroups } };
  }
  if (open.some((d) => d.kind === "not_priced")) return { status: "not_covered", code: "not_priced", words: "no live price yet" };
  const any = open[0];
  return { status: "not_covered", code: any?.kind === "amount_check" || any?.kind === "allergen_unknown" ? "needs_decision" : "not_sold", words: any ? plain(any.text) : `the assortment has no ${spec.name}` };
}

export type Ctx = {
  codeOf: (slug: string) => string | undefined;
  codeOfProduct: (productId: string) => string | undefined;
  kitchenGroups: string[];
  struckByBuyer: (lineId: string) => boolean;
  ruleOf: (l: PlanLineView) => { text: string; source: string } | undefined;
  earliest: (l: PlanLineView) => string | undefined;
};

export type RefusedLike = { dishId: string; name: string; rule: { text: string; source: string }; allergen: string; ingredient: string };

/**
 * The coverage of every ingredient of every dish: as many coverages out as ingredients in (each dish's own list,
 * refused dishes included), none not covered without a code and words.
 */
export function completeness(dishes: readonly DraftDish[], specs: readonly LineSpec[], lines: readonly PlanLineView[], refused: readonly RefusedLike[], ctx: Ctx): Completeness {
  const coverage: Coverage[] = [];
  for (const dish of dishes) {
    const r = refused.find((x) => x.dishId === dish.id);
    for (const ing of dish.ingredients) {
      const base = { dishId: dish.id, dish: dish.name, ingredient: ing.name, ingredientFi: ing.searchTerms[0] && ing.searchTerms[0] !== ing.name ? ing.searchTerms[0] : null, defining: isDefining(ing, [dish.name, dish.nameFi ?? ""].join(" | ")) };
      if (r) {
        coverage.push({ ...base, lineId: null, need: null, status: "not_covered", code: "refused_dish", words: `${dish.name} cannot be made under the rule "${r.rule.text}" (${r.rule.source}): its ${r.ingredient} is ${r.allergen.replace(/_/g, " ")}`, detail: { rule: r.rule } });
        continue;
      }
      const spec = specs.find((s) => s.key === ing.key && s.uses.some((u) => u.dishId === dish.id)) ?? specs.find((s) => s.uses.some((u) => u.dishId === dish.id) && s.name === ing.name);
      const l = spec ? lines.find((x) => x.lineId === spec.lineId) : undefined;
      const owner = l?.status === "merged" ? lines.find((x) => x.lineId === l.mergedInto) : l;
      const use = l?.uses.find((u) => u.dishId === dish.id);
      const need = use ? `${use.gross.amount} ${use.gross.unit === "L" ? "l" : use.gross.unit}` : null;
      const c = spec ? lineCoverage(l, owner, spec, ctx) : { status: "not_covered" as const, code: "not_sold" as const, words: "not planned" };
      coverage.push({ ...base, lineId: spec?.lineId ?? null, need, ...c });
    }
  }
  const covered = coverage.filter((c) => c.status !== "not_covered").length;
  const missing = coverage.filter((c) => c.status === "not_covered");
  return { coverage, complete: missing.length === 0 && coverage.length > 0, ingredients: coverage.length, covered, missing, definingMissing: missing.some((c) => c.defining) };
}
