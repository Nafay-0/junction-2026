import { describe, expect, it } from "vitest";
import { codeLeaks, dayWords, groupOf, groupsOf, sayRefusal, type Refusal } from "./refusal";

const ALL: Refusal[] = [
  { code: "out_of_mandate", what: "burger buns", group: "fresh bakery", groups: ["dairy and cheese", "seasonings, coffee and drinks"], signer: "Owner" },
  { code: "not_sold", what: "camel milk" },
  { code: "cutoff_passed", what: "lactose-free milk", day: "2026-11-16", earliest: "2026-11-17" },
  { code: "forbidden_allergen", what: "pesto", allergens: ["nuts"] },
  { code: "nutrition_rule", what: "oat drink", detail: "1 g protein per 100 ml, under the 3 g your rules ask for" },
  { code: "out_of_stock", what: "cream", day: "2026-11-16" },
  { code: "over_budget", leftCents: 48_000, signer: "Owner" },
  { code: "over_limit", limitCents: 50_000, signer: "Aino Virtanen" },
  { code: "suspended" },
  { code: "mandate_ended" },
  { code: "licence", signer: "Owner" },
  { code: "recall", what: "smoked salmon" },
  { code: "nothing_fits", what: "milk" },
];

describe("refusals in words", () => {
  it("says every refusal in each language without a code, an id or a snake_case word", () => {
    for (const r of ALL)
      for (const lang of ["en", "fi", "sv"] as const) {
        const t = sayRefusal(r, lang);
        expect(t.length, `${r.code} ${lang}`).toBeGreaterThan(20);
        expect(codeLeaks(t), `${r.code} ${lang}: ${t}`).toEqual([]);
      }
  });

  it("says the out-of-mandate case in the first person, the groups in words, with the next step", () => {
    const t = sayRefusal(ALL[0], "en");
    expect(t).toBe("I can't buy burger buns for this kitchen: its rules cover dairy and cheese and seasonings, coffee and drinks, not fresh bakery. Owner can add fresh bakery under Your rules; shall I ask them?");
    expect(t.endsWith("?")).toBe(true);
  });

  it("names a kitchen's product groups in words, at most three", () => {
    expect(groupOf("milk", "en")).toBe("dairy and cheese");
    expect(groupOf("milk", "fi")).toBe("maito- ja juustotuotteet");
    const g = groupsOf(["milk", "cream", "butter", "cat_10418", "cat_22100", "cat_41000", "cat_11000"], "en");
    expect(g.length).toBeLessThanOrEqual(3);
    for (const x of g) expect(codeLeaks(x)).toEqual([]);
  });

  it("writes an English day as people do, and keeps the Finnish one", () => {
    expect(dayWords("2026-11-16", "en")).toBe("Monday 16 Nov");
    expect(dayWords("2026-11-16", "fi")).toBe("ma 16.11.");
  });

  it("finds the codes that must not reach a sentence", () => {
    expect(codeLeaks("its signed mandate covers butter, cat 10418, cat 10431")).toContain("cat 10418");
    expect(codeLeaks("Valio Eila (VA-1010) is late")).toContain("VA-1010");
    expect(codeLeaks("product 464306 is out")).toContain("464306");
    expect(codeLeaks("order ord_7f3a9c12 waits")).toContain("ord_7f3a9c12");
    expect(codeLeaks("refused by category_allowed")).toContain("category_allowed");
    expect(codeLeaks("1 000 L for 1 010,00 € on Monday 16 Nov, 12 × 1 L, 1.5 %")).toEqual([]);
  });
});
