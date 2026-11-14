import { describe, expect, it } from "vitest";
import { SCHOOL_NUTRITION } from "@/server/accounts/test-accounts";
import { labelWords, nutritionRuleWords } from "./nutrition-rules.text";
import { mandateWords } from "./rules";

describe("nutrition and label rules on Your rules, in plain words", () => {
  it("says each of the school's rules in three languages, never a code", () => {
    const en = SCHOOL_NUTRITION.map((r) => nutritionRuleWords(r, "en"));
    expect(en).toEqual([
      "Buy milk or plant drinks with less than 3 g protein per 100 g, or any that does not declare its protein.",
      "Buy yoghurt, plant-based yoghurt or quark with more than 12 g sugar per 100 g, or any that does not declare its sugar.",
      "Buy cheese, sliced cheese or grated cheese with more than 1,2 g salt per 100 g, or any that does not declare its salt.",
      "Buy rye bread, toast bread or bread loaves with less than 6 g fibre per 100 g, or any that does not declare its fibre.",
    ]);
    expect(nutritionRuleWords(SCHOOL_NUTRITION[1], "fi")).toBe("Ostaa tuotetta (jogurtti, kasvipohjainen jogurtti, rahka), jossa on yli 12 g sokeria / 100 g, tai joka ei ilmoita sokeria.");
    expect(nutritionRuleWords(SCHOOL_NUTRITION[2], "sv")).toBe("Köpa ost, skivad ost eller riven ost med mer än 1,2 g salt per 100 g, eller som inte anger sitt innehåll av salt.");
    for (const lang of ["en", "fi", "sv"] as const) for (const r of SCHOOL_NUTRITION) expect(nutritionRuleWords(r, lang)).not.toMatch(/cat_|_/);
    expect(labelWords(["origin_fi", "msc"], "en")).toBe("Finnish origin and MSC");
  });

  it("puts them beside the allergen rule, and the label preference with what the agent may do", () => {
    const m = { perOrderLimitCents: 25000, weeklyBudgetCents: 250000, allowedCategories: ["milk"], requiredAttributes: [], forbiddenAllergens: ["nuts"], nutritionRules: SCHOOL_NUTRITION, preferredLabels: ["origin_fi"], maxLeadDays: 5, substitution: { rule: "within_preferences" as const, maxPriceIncreasePct: 10 }, approvers: [], validUntil: "2026-12-01T00:00:00.000Z" };
    const w = mandateWords(m, "en");
    const i = w.never.findIndex((x) => /nuts/.test(x));
    expect(w.never.slice(i + 1, i + 5)).toEqual(SCHOOL_NUTRITION.map((r) => nutritionRuleWords(r, "en")));
    expect(w.alone).toContain("Prefer products with Finnish origin, and say what that costs.");
  });
});
