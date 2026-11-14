import { describe, expect, it } from "vitest";
import { NutritionRuleSchema, compareNutrition, comparisonText, decodeComparison, encodeComparison, nutritionFindings, ruleText, type Nutrition, type NutritionRule } from "./nutrition";

const yoghurt: Nutrition = { per: "100g", values: { sugar: 11.5, salt: 0.1, protein: 4, saturated_fat: 0.5 }, lessThan: ["saturated_fat"] };
const rules: NutritionRule[] = [
  { nutrient: "sugar", max: 12, categories: ["yoghurt"] },
  { nutrient: "protein", min: 3, categories: ["milk", "plant_drink"] },
];
const find = (category: string, nutrition?: Nutrition | null, r = rules) => nutritionFindings(r, { productId: "P1", category, nutrition });

describe("nutrition rules", () => {
  it("passes a product that keeps every rule for its kind, and ignores rules for other kinds", () => {
    expect(find("yoghurt", yoghurt)).toEqual([]);
    expect(find("cheese", null)).toEqual([]); // no rule speaks of cheese
  });

  it("refuses a figure over a ceiling or under a floor, naming the figure and the rule", () => {
    const over = find("yoghurt", { per: "100g", values: { sugar: 13.2 } });
    expect(over).toHaveLength(1);
    expect(over[0].problem).toBe("over");
    expect(over[0].reason).toMatch(/13\.2 g sugar per 100 g, over the 12 g/);
    const under = find("plant_drink", { per: "100ml", values: { protein: 1 } });
    expect(under[0].problem).toBe("under");
    expect(under[0].reason).toMatch(/1 g protein per 100 ml, under the 3 g/);
  });

  it("treats a missing declaration or a missing figure as unknown, never compliant", () => {
    expect(find("yoghurt", undefined)[0]).toMatchObject({ problem: "unknown" });
    expect(find("yoghurt", { per: "100g", values: { salt: 0.1 } })[0].reason).toMatch(/no sugar figure.*Unknown is not compliant/);
  });

  it("reads 'less than' as an upper bound: it can keep a ceiling, never reach a floor", () => {
    const lt: Nutrition = { per: "100ml", values: { sugar: 0.5, protein: 0.5 }, lessThan: ["sugar", "protein"] };
    expect(nutritionFindings([{ nutrient: "sugar", max: 1 }], { productId: "P", category: "x", nutrition: lt })).toEqual([]);
    expect(nutritionFindings([{ nutrient: "sugar", max: 0.2 }], { productId: "P", category: "x", nutrition: lt })[0].problem).toBe("unknown");
    expect(nutritionFindings([{ nutrient: "protein", min: 0.1 }], { productId: "P", category: "x", nutrition: lt })[0].problem).toBe("unknown");
  });

  it("validates a rule and says it in words", () => {
    expect(NutritionRuleSchema.safeParse({ nutrient: "salt" }).success).toBe(false);
    expect(NutritionRuleSchema.safeParse({ nutrient: "salt", min: 2, max: 1 }).success).toBe(false);
    expect(NutritionRuleSchema.safeParse({ nutrient: "calcium", min: 100 }).success).toBe(false); // shown, not ruled
    expect(ruleText({ nutrient: "salt", max: 1.2, categories: ["cat_10600"] })).toBe("at most 1.2 g salt per 100 g or ml (cat_10600)");
    expect(ruleText({ nutrient: "fibre", min: 6 })).toBe("at least 6 g fibre per 100 g or ml");
  });
});

describe("comparing a substitute's nutrition", () => {
  const milk: Nutrition = { per: "100ml", values: { protein: 3.4, salt: 0.1, sugar: 4.8, fat: 1.5 } };
  it("says what is the same and what changes, the kitchen's ruled nutrients first", () => {
    const other: Nutrition = { per: "100ml", values: { protein: 3.4, salt: 0.4, sugar: 3.1 } };
    const c = compareNutrition(milk, other, ["sugar"])!;
    expect(c.deltas.map((d) => d.nutrient)).toEqual(["sugar", "protein", "salt"]);
    expect(c.unknown).toEqual(["fat"]);
    expect(comparisonText(c)).toBe("1.7 g less sugar, same protein, 0.3 g more salt, fat not declared per 100 g or ml");
    const round = decodeComparison(encodeComparison(c));
    expect(round[0]).toEqual({ nutrient: "sugar", delta: -1.7, same: false });
    expect(round[1]).toEqual({ nutrient: "protein", delta: 0, same: true });
    expect(round.at(-1)).toEqual({ nutrient: "fat", unknown: true });
  });

  it("compares nothing across bases, and says when the substitute declares nothing", () => {
    expect(compareNutrition(milk, { per: "100g", values: { protein: 3 } })!.comparable).toBe(false);
    const none = compareNutrition(milk, undefined)!;
    expect(none.comparable).toBe(false);
    expect(comparisonText(none)).toMatch(/no nutrition declaration/);
    expect(compareNutrition(undefined, milk)).toBeUndefined();
  });
});
