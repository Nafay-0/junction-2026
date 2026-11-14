import { describe, expect, it } from "vitest";
import { codeLeaks } from "@/server/thread/refusal";
import { mandateWords } from "./rules";

describe("Your rules in words", () => {
  it("names the product groups, never a category code, in each language", () => {
    const m = { perOrderLimitCents: 6000, weeklyBudgetCents: 40000, allowedCategories: ["butter", "cat_10418", "cat_10431", "cat_22100", "cat_11000", "milk"], requiredAttributes: [], forbiddenAllergens: [], maxLeadDays: 5, approvers: [], substitution: { rule: "within_preferences" } } as never;
    for (const lang of ["en", "fi", "sv"] as const) {
      const w = mandateWords(m, lang);
      const text = [...w.alone, ...w.person, ...w.never].join(" ");
      expect(codeLeaks(text), text).toEqual([]);
      expect(text).not.toMatch(/\bcat \d+/);
    }
    expect(mandateWords(m, "en").alone.join(" ")).toMatch(/dairy and cheese/);
  });
});
