import { describe, expect, it } from "vitest";
import { allergenInName, definingConflict, missingEssentials, ruleFor } from "./dish-rules";

const ing = (key: string, name: string, searchTerms: string[] = [], role = "in the dish") => ({ key, name, searchTerms, role });
const METSOLA = [
  { text: "Nut-free kitchen: no nuts, no traces", source: "stated by Food service manager" },
  { text: "No fish", source: "mandate" },
  { text: "No sesame", source: "mandate" },
];

describe("a dish whose defining ingredient breaks a kitchen rule is refused, with the rule named", () => {
  it("fish fingers and mash in a kitchen that forbids fish, even when the draft left the fish out", () => {
    const dish = { name: "Kalapuikot ja perunamuusi", ingredients: [ing("potato", "Potato", ["peruna"]), ing("butter", "Butter", ["voi"])] };
    expect(definingConflict(dish, ["nuts", "peanuts", "sesame", "fish"], METSOLA)).toEqual({ allergen: "fish", ingredient: "kalapuikot", rule: { text: "No fish", source: "mandate" } });
  });

  it("pesto pasta with salmon: the salmon, under the fish rule", () => {
    const dish = { name: "Pesto pasta with salmon", ingredients: [ing("pasta", "Pasta"), ing("salmon_fillet", "Salmon fillet", ["lohifilee"], "main protein")] };
    expect(definingConflict(dish, ["fish"], METSOLA)).toMatchObject({ allergen: "fish", ingredient: "Salmon fillet", rule: { text: "No fish" } });
  });

  it("a defining ingredient the name does not say, and not a side ingredient or a word that only looks like it", () => {
    expect(definingConflict({ name: "Nordic bowl", ingredients: [ing("herring", "Pickled herring", ["silli"], "main protein")] }, ["fish"], METSOLA)?.ingredient).toBe("Pickled herring");
    expect(definingConflict({ name: "Chicken with rice", ingredients: [ing("chicken", "Chicken", [], "main protein"), ing("rice", "Rice")] }, ["fish", "nuts"], METSOLA)).toBeUndefined();
    expect(allergenInName("Butternut squash soup with nutmeg", ["nuts"])).toBeUndefined();
    expect(allergenInName("Munakoisolasagne", ["eggs"])).toBeUndefined();
    expect(allergenInName("Satay chicken", ["peanuts"])).toBe("peanuts");
    expect(allergenInName("Dry pasta fusilli", ["fish"])).toBeUndefined();
    expect(allergenInName("Kirjolohifilee", ["fish"])).toBe("fish");
  });

  it("names the rule as the kitchen's people wrote it, else one made from the allergen", () => {
    expect(ruleFor("nuts", METSOLA)).toEqual({ text: "Nut-free kitchen: no nuts, no traces", source: "stated by Food service manager" });
    expect(ruleFor("eggs", METSOLA)).toEqual({ text: "No eggs", source: "the kitchen's rules" });
  });
});

describe("a recipe must be complete", () => {
  it("a chocolate cake with no flour and no sugar fails, and says what to add", () => {
    const cake = { name: "Chocolate cake", ingredients: [ing("dark_chocolate", "Dark baking chocolate"), ing("butter", "Butter"), ing("egg", "Egg"), ing("cocoa", "Cocoa powder"), ing("baking_powder", "Baking powder")] };
    const missing = missingEssentials(cake);
    expect(missing.map((m) => m.what)).toEqual(["flour or a flour substitute", "a sweetener"]);
    expect(missing.map((m) => m.add.key)).toEqual(["wheat_flour", "sugar"]);
  });

  it("passes with a flour substitute and a sweetener, and staples the kitchen keeps count as there", () => {
    expect(missingEssentials({ name: "Gluten-free chocolate cake", ingredients: [ing("almond_flour", "Almond flour", ["mantelijauho"]), ing("sugar", "Sugar")] })).toEqual([]);
    expect(missingEssentials({ name: "Suklaakakku", ingredients: [ing("wheat_flour", "Wheat flour"), ing("sugar", "Sugar")] })).toEqual([]);
  });

  it("pancakes, mash and porridge have their own needs; other dishes are not judged", () => {
    expect(missingEssentials({ name: "Pannukakku", ingredients: [ing("flour", "Wheat flour"), ing("milk", "Milk")] }).map((m) => m.what)).toEqual(["egg or an egg substitute"]);
    expect(missingEssentials({ name: "Kalapuikot ja perunamuusi", ingredients: [ing("butter", "Butter"), ing("milk", "Milk")] }).map((m) => m.add.key)).toEqual(["potato"]);
    expect(missingEssentials({ name: "Fish cake", ingredients: [ing("fish", "Fish")] })).toEqual([]);
    expect(missingEssentials({ name: "Beef stew", ingredients: [ing("beef", "Beef")] })).toEqual([]);
  });
});
