import { describe, expect, it } from "vitest";
import { allergenOf, claimOf, forbiddenPresent, hasAllergen, resolveConstraints } from "./vocabulary";

describe("one constraint vocabulary (gate, intake, knowledge map)", () => {
  it("maps allergen words in English, Finnish and Swedish onto the catalogue's slugs", () => {
    expect(["tree_nuts", "tree nut", "pähkinä", "nötter", "Pähkinät"].map(allergenOf)).toEqual(["nuts", "nuts", "nuts", "nuts", "nuts"]);
    expect(["peanut", "maapähkinä", "jordnöt"].map(allergenOf)).toEqual(["peanuts", "peanuts", "peanuts"]);
    expect(["laktoosi", "laktos", "lactose"].map(allergenOf)).toEqual(["lactose", "lactose", "lactose"]);
    expect(["maito", "mjölk", "dairy"].map(allergenOf)).toEqual(["milk", "milk", "milk"]);
    expect(["kananmuna", "ägg", "egg"].map(allergenOf)).toEqual(["eggs", "eggs", "eggs"]);
    expect(["gluteeni", "vehnä", "hasselpähkinä"].map(allergenOf)).toEqual(["gluten", "wheat", "hazelnut"]);
    expect(allergenOf("gs1:XY")).toBe("gs1:xy");
  });

  it("returns nothing for a word it cannot map, so callers refuse it", () => {
    expect(allergenOf("unicorn_dust")).toBeUndefined();
    expect(claimOf("very healthy")).toBeUndefined();
    const r = resolveConstraints({ requiredClaims: ["laktoositon", "nut-free", "magic"], forbiddenAllergens: ["jordnöt", "kryptonite"] });
    expect(r.requiredClaims).toEqual(["lactose_free"]);
    expect(r.forbiddenAllergens).toEqual(["nuts", "peanuts"]);
    expect(r.unknown).toEqual([{ word: "magic", as: "claim" }, { word: "kryptonite", as: "allergen" }]);
  });

  it("milk without a lactose-free claim carries lactose; a hazelnut is a nut; an unknown word matches everything", () => {
    expect(hasAllergen({ present: ["milk"], claims: [] }, "lactose")).toBe(true);
    expect(hasAllergen({ present: ["milk"], claims: ["lactose_free"] }, "lactose")).toBe(false);
    expect(hasAllergen({ present: ["hazelnut"], claims: [] }, "nuts")).toBe(true);
    expect(hasAllergen({ present: ["nuts"], claims: [] }, "hazelnut")).toBe(true);
    expect(hasAllergen({ present: ["wheat"], claims: [] }, "gluten")).toBe(true);
    expect(hasAllergen({ present: ["fish"], claims: [] }, "nuts")).toBe(false);
    expect(hasAllergen({ present: [], claims: [] }, "unicorn_dust")).toBe(true);
    expect(forbiddenPresent({ present: ["milk", "gluten"], claims: [] }, ["lactose", "nuts", "gluteeni"])).toEqual(["lactose", "gluteeni"]);
  });
});
