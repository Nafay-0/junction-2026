import { z } from "zod";

/**
 * Nutrition, as the maker declares it (the partner's `nutritionalContent`, per 100 g or 100 ml), and the nutrition
 * rules a kitchen signs beside its allergen rules: "at most 1.2 g salt per 100 g of cheese", "at most 12 g sugar per
 * 100 g of yoghurt", "at least 6 g fibre per 100 g of bread". The gate checks every rule on every door, like the
 * allergen rules, and with the same honesty: a product whose declaration has no figure for the nutrient is unknown,
 * never compliant. Pure: no I/O, no clock, no model.
 */

/** The nutrients Dock reads, in the order the index stores them. */
export const NUTRIENTS = [
  "energy_kcal",
  "fat",
  "saturated_fat",
  "carbohydrate",
  "sugar",
  "fibre",
  "protein",
  "salt",
  "lactose",
  "calcium",
  "iron",
  "vitamin_d",
  "vitamin_b12",
] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

/** The unit each nutrient is stated in, per 100 g or 100 ml. */
export const NUTRIENT_UNIT: Record<Nutrient, "kcal" | "g" | "mg" | "µg"> = {
  energy_kcal: "kcal",
  fat: "g",
  saturated_fat: "g",
  carbohydrate: "g",
  sugar: "g",
  fibre: "g",
  protein: "g",
  salt: "g",
  lactose: "g",
  calcium: "mg",
  iron: "mg",
  vitamin_d: "µg",
  vitamin_b12: "µg",
};

/** The nutrients a kitchen can sign a rule on: the declaration's main figures (minerals and vitamins are shown, not ruled). */
export const RULE_NUTRIENTS = ["energy_kcal", "fat", "saturated_fat", "carbohydrate", "sugar", "fibre", "protein", "salt", "lactose"] as const satisfies readonly Nutrient[];

/** What one product's declaration says, per 100 g (solids) or 100 ml (drinks). A nutrient not in `values` is unknown. */
export type Nutrition = {
  per: "100g" | "100ml";
  values: Partial<Record<Nutrient, number>>;
  /** Figures the maker states only as "less than" (the value is then an upper bound, not an amount). */
  lessThan?: Nutrient[];
};

export const NutritionSchema = z.object({
  per: z.enum(["100g", "100ml"]),
  values: z.partialRecord(z.enum(NUTRIENTS), z.number().nonnegative()),
  lessThan: z.array(z.enum(NUTRIENTS)).optional(),
});

/**
 * A rule a kitchen signs: a ceiling (`max`), a floor (`min`) or both, in the nutrient's unit per 100 g or 100 ml, for
 * the product kinds named (`categories`, Dock's category slugs: "yoghurt", "milk", "cat_11010"), or for every product
 * when none are named.
 */
export const NutritionRuleSchema = z
  .object({
    nutrient: z.enum(RULE_NUTRIENTS),
    max: z.number().nonnegative().max(1000).optional(),
    min: z.number().nonnegative().max(1000).optional(),
    categories: z.array(z.string().min(1).max(40)).min(1).max(50).optional(),
  })
  .refine((r) => r.max !== undefined || r.min !== undefined, { message: "a nutrition rule needs a max, a min or both" })
  .refine((r) => r.max === undefined || r.min === undefined || r.min <= r.max, { message: "min must not be above max" });
export type NutritionRule = z.infer<typeof NutritionRuleSchema>;

const EPS = 1e-9;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number) => String(round(n, n < 1 ? 2 : 1));

/** "1.2 g salt", "12 g sugar", "150 kcal". */
export function amountText(nutrient: Nutrient, value: number): string {
  const unit = NUTRIENT_UNIT[nutrient];
  return `${fmt(value)} ${unit} ${nutrientWord(nutrient)}`;
}

export function nutrientWord(n: Nutrient): string {
  return n === "energy_kcal" ? "energy" : n.replaceAll("_", " ");
}

/** A rule in plain English, for the gate's reasons and the ledger: "at most 1.2 g salt per 100 g (yoghurt)". */
export function ruleText(r: NutritionRule): string {
  const unit = NUTRIENT_UNIT[r.nutrient];
  const what = nutrientWord(r.nutrient);
  const range =
    r.max !== undefined && r.min !== undefined
      ? `${fmt(r.min)} to ${fmt(r.max)} ${unit} ${what}`
      : r.max !== undefined
        ? `at most ${fmt(r.max)} ${unit} ${what}`
        : `at least ${fmt(r.min!)} ${unit} ${what}`;
  return `${range} per 100 g or ml${r.categories?.length ? ` (${r.categories.join(", ")})` : ""}`;
}

/** Whether a rule speaks about a product of this category. */
export function ruleApplies(r: NutritionRule, category: string): boolean {
  return !r.categories?.length || r.categories.includes(category);
}

export type NutritionFinding = {
  rule: NutritionRule;
  /** over: above the max; under: below the min; unknown: the declaration does not show it either way. */
  problem: "over" | "under" | "unknown";
  value?: number;
  reason: string;
};

/**
 * What a product's declaration says against the kitchen's rules: one finding per rule it breaks or cannot be shown
 * to keep. Unknown is never compliant: no declaration, no figure for the nutrient, or a "less than" figure that does
 * not settle it (it can show a ceiling is kept, never that a floor is reached).
 */
export function nutritionFindings(rules: readonly NutritionRule[], product: { productId: string; category: string; nutrition?: Nutrition | null }): NutritionFinding[] {
  const out: NutritionFinding[] = [];
  for (const r of rules) {
    if (!ruleApplies(r, product.category)) continue;
    const n = product.nutrition;
    const v = n?.values[r.nutrient];
    const per = n?.per === "100ml" ? "100 ml" : "100 g";
    const word = nutrientWord(r.nutrient);
    const unit = NUTRIENT_UNIT[r.nutrient];
    if (!n || v === undefined) {
      out.push({ rule: r, problem: "unknown", reason: `${product.productId} has no ${word} figure in its maker's nutrition declaration, so nothing shows ${ruleText(r).replace(/ \(.*\)$/, "")}. Unknown is not compliant: choose a product that declares it.` });
      continue;
    }
    const lessThan = n.lessThan?.includes(r.nutrient) ?? false;
    if (r.max !== undefined && v > r.max + EPS) {
      out.push({ rule: r, problem: lessThan ? "unknown" : "over", value: v, reason: lessThan ? `${product.productId} states less than ${fmt(v)} ${unit} ${word} per ${per}, which does not show it is at most ${fmt(r.max)} ${unit}.` : `${product.productId} has ${fmt(v)} ${unit} ${word} per ${per}, over the ${fmt(r.max)} ${unit} the kitchen allows.` });
      continue;
    }
    if (r.min !== undefined && (lessThan || v < r.min - EPS)) {
      out.push({ rule: r, problem: lessThan ? "unknown" : "under", value: v, reason: lessThan ? `${product.productId} states less than ${fmt(v)} ${unit} ${word} per ${per}, which does not show at least ${fmt(r.min)} ${unit}.` : `${product.productId} has ${fmt(v)} ${unit} ${word} per ${per}, under the ${fmt(r.min)} ${unit} the kitchen requires.` });
    }
  }
  return out;
}

// ---------- comparing a substitute with the product it replaces ----------

/** The nutrients a comparison names when the kitchen has no rule on them: what a kitchen reads first. */
export const COMPARED_NUTRIENTS: readonly Nutrient[] = ["protein", "salt", "sugar", "saturated_fat", "fat", "fibre", "energy_kcal"];

export type NutrientDelta = { nutrient: Nutrient; original: number; substitute: number; delta: number; same: boolean };
export type NutritionComparison = {
  /** Both declare it: the difference, substitute minus original, per 100 g or ml. */
  deltas: NutrientDelta[];
  /** Nutrients the original declares and the substitute does not: unknown, said so. */
  unknown: Nutrient[];
  /** False when the two are declared per a different basis (100 g against 100 ml): no figure is compared. */
  comparable: boolean;
};

/** Two figures are the same when they round to the same tenth (energy: the same whole kcal; mg and µg: whole units). */
function same(n: Nutrient, a: number, b: number): boolean {
  const d = NUTRIENT_UNIT[n] === "g" ? 1 : 0;
  return round(a, d) === round(b, d);
}

/**
 * How a substitute's declaration differs from the original's, nutrient by nutrient: the kitchen's own ruled
 * nutrients first, then the usual ones. Only figures both declare are compared; what the substitute does not
 * declare is listed as unknown, never as the same.
 */
export function compareNutrition(original: Nutrition | null | undefined, substitute: Nutrition | null | undefined, focus: readonly Nutrient[] = []): NutritionComparison | undefined {
  if (!original) return undefined;
  const order = [...new Set([...focus, ...COMPARED_NUTRIENTS])];
  if (!substitute) return { deltas: [], unknown: order.filter((n) => original.values[n] !== undefined), comparable: false };
  if (original.per !== substitute.per) return { deltas: [], unknown: [], comparable: false };
  const deltas: NutrientDelta[] = [];
  const unknown: Nutrient[] = [];
  for (const n of order) {
    const a = original.values[n];
    const b = substitute.values[n];
    if (a === undefined) continue;
    if (b === undefined || substitute.lessThan?.includes(n) || original.lessThan?.includes(n)) {
      if (b === undefined) unknown.push(n);
      continue;
    }
    deltas.push({ nutrient: n, original: a, substitute: b, delta: round(b - a, 2), same: same(n, a, b) });
  }
  return { deltas, unknown, comparable: true };
}

/** "same protein, 0.3 g less salt, 2 g more sugar per 100 g": the first few differences that matter, in English. */
export function comparisonText(c: NutritionComparison | undefined, max = 3): string | undefined {
  if (!c) return undefined;
  if (!c.comparable) return c.unknown.length ? `no nutrition declaration to compare (${c.unknown.slice(0, 2).map(nutrientWord).join(", ")} unknown)` : undefined;
  const parts = c.deltas.slice(0, max).map((d) => (d.same ? `same ${nutrientWord(d.nutrient)}` : `${fmt(Math.abs(d.delta))} ${NUTRIENT_UNIT[d.nutrient]} ${d.delta < 0 ? "less" : "more"} ${nutrientWord(d.nutrient)}`));
  if (c.unknown.length) parts.push(`${c.unknown.slice(0, 2).map(nutrientWord).join(" and ")} not declared`);
  return parts.length ? `${parts.join(", ")} per 100 g or ml` : undefined;
}

/** Compact form for option reasons: "protein:0:s|salt:-0.3|sugar:2" (`:s` marks the same), unknown as "salt:?". */
export function encodeComparison(c: NutritionComparison | undefined, max = 4): string {
  if (!c || !c.comparable) return "";
  return [...c.deltas.slice(0, max).map((d) => `${d.nutrient}:${d.delta}${d.same ? ":s" : ""}`), ...c.unknown.slice(0, 2).map((n) => `${n}:?`)].join("|");
}

export function decodeComparison(s: string): { nutrient: Nutrient; delta?: number; same?: boolean; unknown?: boolean }[] {
  return s
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [n, d, flag] = part.split(":");
      const nutrient = (NUTRIENTS as readonly string[]).includes(n) ? (n as Nutrient) : undefined;
      if (!nutrient) return undefined;
      return d === "?" ? { nutrient, unknown: true } : { nutrient, delta: Number(d), same: flag === "s" };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}
