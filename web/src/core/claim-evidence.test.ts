import { describe, expect, it } from "vitest";
import { claimEvidence, evidenceText, isNonFood, shortfallText, subjectOfLine, wholeIngredients, type ClaimSubject } from "./claim-evidence";

const oil: ClaimSubject = { claims: [], category: "21410", declared: true, present: [] };
const butter: ClaimSubject = { claims: [], category: "10500", declared: true, present: ["milk"] };
const bread: ClaimSubject = { claims: [], category: "10900", declared: true, present: ["gluten", "wheat"], };
const traces: ClaimSubject = { claims: [], category: "52000", declared: true, present: ["milk"] }; // "may contain milk" is in present too
const unknown: ClaimSubject = { claims: [], category: "17300", declared: false, present: [] };
const carrot: ClaimSubject = { claims: [], category: "17443", declared: false, present: [], byNature: { allergens: [] } };
const celeriac: ClaimSubject = { claims: [], category: "17443", declared: false, present: [], byNature: { allergens: ["celery"] } };
const detergent: ClaimSubject = { claims: [], category: "63210", declared: false, present: [] };

describe("claim evidence: lactose comes only from milk", () => {
  it("the maker's claim", () => {
    expect(claimEvidence({ ...butter, claims: ["lactose_free"] }, "lactose_free")).toEqual({ claim: "lactose_free", met: true, kind: "claim" });
  });

  it("a declaration without milk (truffle oil, olive oil) is lactose-free, and says so", () => {
    const e = claimEvidence(oil, "lactose_free");
    expect(e).toEqual({ claim: "lactose_free", met: true, kind: "declaration" });
    expect(evidenceText(e as never)).toBe("no milk in the maker's allergen declaration");
    expect(claimEvidence(oil, "low_lactose")).toMatchObject({ met: true, kind: "declaration" });
  });

  it("milk in the declaration, contained or may-contain, without a lactose-free claim, is not", () => {
    const e = claimEvidence(butter, "lactose_free");
    expect(e).toEqual({ claim: "lactose_free", met: false, why: "declared_present", allergens: ["milk"] });
    expect(shortfallText(e as never)).toBe("not lactose-free: its allergen declaration lists milk and it carries no lactose-free claim");
    expect(claimEvidence(traces, "lactose_free").met).toBe(false);
  });

  it("a food with no declaration is unknown, not lactose-free", () => {
    expect(claimEvidence(unknown, "lactose_free")).toEqual({ claim: "lactose_free", met: false, why: "no_declaration" });
  });

  it("whole fresh produce by its nature, unless the kitchen accepts declared data only", () => {
    expect(claimEvidence(carrot, "lactose_free")).toEqual({ claim: "lactose_free", met: true, kind: "nature" });
    expect(claimEvidence(carrot, "lactose_free", { strict: true })).toEqual({ claim: "lactose_free", met: false, why: "nature_not_accepted" });
    // Strict keeps the maker's declaration: it is the maker's own word.
    expect(claimEvidence(oil, "lactose_free", { strict: true })).toMatchObject({ met: true, kind: "declaration" });
    expect(claimEvidence(celeriac, "lactose_free").met).toBe(true);
  });

  it("not food at all: cleaning, hygiene, disposables", () => {
    expect(claimEvidence(detergent, "lactose_free", { rule: true })).toEqual({ claim: "lactose_free", met: true, kind: "not_food" });
    expect(claimEvidence(detergent, "lactose_free", { strict: true, rule: true }).met).toBe(true);
    // The buyer's own words describe food: a lasagne spatula is not "gluten-free lasagne sheets".
    expect(claimEvidence(detergent, "gluten_free").met).toBe(false);
    expect(isNonFood("cat_64100")).toBe(true);
    expect(isNonFood("10400")).toBe(false);
    expect(isNonFood("milk")).toBe(false);
  });
});

describe("claim evidence for other claims that follow from an allergen declaration", () => {
  it("egg-, soy-, wheat- and gluten-free from the declaration; oats need the gluten-free claim", () => {
    expect(claimEvidence(oil, "egg_free").met).toBe(true);
    expect(claimEvidence(oil, "soy_free").met).toBe(true);
    expect(claimEvidence(bread, "wheat_free")).toMatchObject({ met: false, allergens: ["wheat"] });
    expect(claimEvidence(bread, "gluten_free")).toMatchObject({ met: false });
    expect(claimEvidence({ ...oil, present: ["gluten"] }, "wheat_free").met).toBe(false); // generic gluten may be wheat
    expect(claimEvidence({ ...oil, present: ["oats"] }, "gluten_free")).toMatchObject({ met: false, allergens: ["oats"] });
    expect(claimEvidence(oil, "gluten_free")).toMatchObject({ met: true, kind: "declaration" });
  });

  it("organic, vegan and vegetarian stay claim-only", () => {
    for (const c of ["organic", "vegan", "vegetarian", "fat_1_5"]) expect(claimEvidence(oil, c)).toEqual({ claim: c, met: false, why: "claim_only" });
    expect(claimEvidence({ ...oil, claims: ["vegan"] }, "vegan").met).toBe(true);
  });

  it("reads a signed quote line: its by-nature allergens are not mistaken for a declaration", () => {
    const line = { attributes: [], category: "cat_17443", allergens: ["celery"], allergensDeclared: false, allergensByNature: { allergens: ["celery"] } };
    expect(subjectOfLine(line)).toEqual({ claims: [], category: "cat_17443", declared: false, present: [], byNature: { allergens: ["celery"] } });
    expect(claimEvidence(subjectOfLine(line), "lactose_free")).toMatchObject({ met: true, kind: "nature" });
  });
});

describe("claim evidence from the maker's ingredient list (lactose only)", () => {
  const truffleOil: ClaimSubject = { claims: [], category: "10531", declared: false, present: [], ingredients: "extra virgin olive oil, black truffle aroma | extra virgin oliiviöljy, mustatryffeliaromi" };
  it("an undeclared truffle oil whose whole ingredient list names no milk is lactose-free, said as such", () => {
    const e = claimEvidence(truffleOil, "lactose_free");
    expect(e).toEqual({ claim: "lactose_free", met: true, kind: "ingredients" });
    expect(evidenceText(e as never)).toBe("no milk in the maker's ingredient list (it sent no allergen declaration)");
  });
  it("milk in any language in the list refuses it; plant milks and cocoa butter do not", () => {
    for (const t of ["sugar, whole MILK powder", "sokeri, kermajauhe", "socker, vasslepulver", "voi, suola"]) expect(claimEvidence({ ...truffleOil, ingredients: t }, "lactose_free")).toMatchObject({ met: false, why: "listed_in_ingredients" });
    expect(claimEvidence({ ...truffleOil, ingredients: "cocoa mass, cocoa butter, sugar, coconut milk" }, "lactose_free").met).toBe(true);
  });
  it("not under strict evidence, not for allergies, and never from a shortened list", () => {
    expect(claimEvidence(truffleOil, "lactose_free", { strict: true })).toMatchObject({ met: false, why: "no_declaration" });
    expect(claimEvidence(truffleOil, "egg_free")).toMatchObject({ met: false, why: "no_declaration" });
    expect(wholeIngredients({ en: "olive oil, truffle aroma", fi: "oliiviöljy, tryffeli…" })).toBeUndefined();
    expect(wholeIngredients({ en: "olive oil, truffle aroma" })).toBe("olive oil, truffle aroma");
  });
});
