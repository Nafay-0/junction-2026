import { describe, expect, it } from "vitest";
import { hardCheck } from "./facts";
import { KnowledgeMap, SERVE_THRESHOLD } from "./map";
import { testKnowledge, testProducts } from "./test-catalogue";
import { decodeKnowledge, encodeKnowledge, profileFromAnswer } from "./types";

const products = testProducts();
const byId = new Map(products.map((p) => [p.id, p]));
const P = (id: string) => byId.get(id)!;
const map = new KnowledgeMap(products, testKnowledge());
const ids = (xs: { productId: string }[]) => xs.map((x) => x.productId);

describe("hard facts (data fields only)", () => {
  it("a lactose-free original refuses a low-lactose-only substitute, a low-lactose original accepts a lactose-free one", () => {
    const r = hardCheck(P("800021"), P("800022"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("claim_missing");
    expect(hardCheck(P("800022"), P("800021")).ok).toBe(true);
  });

  it("refuses a substitute that adds an allergen, including contains-where-the-original-only-may-contain", () => {
    const r = hardCheck(P("800030"), P("800033"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/walnut/);
  });

  it("treats milk that is not lactose-free as carrying lactose, whether or not the maker lists it", () => {
    expect(hardCheck(P("800023"), P("800004")).ok).toBe(true); // regular milk -> cream listing milk + lactose: nothing new
  });

  it("missing allergen data is unknown, never safe", () => {
    // Original declares, candidate does not: refused.
    const veg = P("800040");
    const r = hardCheck(P("800030"), veg);
    expect(r.ok).toBe(false);
    // Neither declares: allowed, marked unknown.
    const both = hardCheck(veg, P("800041"));
    expect(both).toMatchObject({ ok: true, allergens: "unknown" });
    // A buyer who forbids an allergen never gets a product without data.
    const forb = hardCheck(veg, P("800041"), { forbiddenAllergens: ["celery"] });
    expect(forb).toMatchObject({ ok: false, code: "allergen_unknown" });
  });

  it("does not assume the vegetarian tag on dairy is relied on, but enforces it when the buyer asks", () => {
    expect(hardCheck(P("800020"), P("800021"), {}, { inherentlyVegetarian: true }).ok).toBe(true);
    expect(hardCheck(P("800020"), P("800021"), {}, { inherentlyVegetarian: false }).ok).toBe(false);
    expect(hardCheck(P("800020"), P("800021"), { requiredClaims: ["vegetarian"] }, { inherentlyVegetarian: true }).ok).toBe(false);
  });
});

describe("alternatives", () => {
  it("for whipping, serves only products that whip and keep the claims; cooking cream never", () => {
    const r = map.alternatives("800001", { use: "whipping" })!;
    const all = [...ids(r.substitutes), ...ids(r.packAlternatives)];
    expect(all).not.toContain("800005"); // cooking cream: does not whip
    expect(all).not.toContain("800006"); // coffee cream
    expect(all).not.toContain("800004"); // not lactose-free by its data
    expect(ids(r.substitutes)[0]).toBe("800003"); // same kind, other brand
    expect(r.substitutes[0].tier).toBe("best");
    expect(r.substitutes[0].checks.claimsKept).toContain("lactose_free");
  });

  it("keeps a pack-size twin apart from substitutes", () => {
    const r = map.alternatives("800001", { use: "whipping" })!;
    expect(ids(r.packAlternatives)).toEqual(["800002"]);
    expect(ids(r.substitutes)).not.toContain("800002");
  });

  it("for sauce, a cooking cream can stand in for whipping cream, a coffee cream that splits is dropped", () => {
    const r = map.alternatives("800001", { use: "sauce", debug: true })!;
    expect(ids(r.substitutes)).toContain("800005");
    expect(ids(r.substitutes)).not.toContain("800006");
    const dropped = r.dropped!.find((d) => d.productId === "800006");
    expect(dropped?.confidence).toBeLessThan(SERVE_THRESHOLD);
    const cooking = r.substitutes.find((s) => s.productId === "800005")!;
    expect(cooking.reason).toMatch(/^Cooking cream for sauces; fat 35% → 15%; will not whip/);
    expect(cooking.changes.map((c) => c.kind)).toContain("fat");
  });

  it("a flavoured, sweetened variant is not served for a plain use", () => {
    const r = map.alternatives("800005", { use: "sauce" })!;
    expect(ids(r.substitutes)).not.toContain("800007");
  });

  it("crosses into plant products only through a bridge for the use, and the allergens must still hold", () => {
    const r = map.alternatives("800005", { use: "sauce", debug: true })!; // lactose-free dairy cooking cream
    expect(ids(r.substitutes)).not.toContain("800011"); // the oat cooking product adds oats
    expect(r.dropped!.find((d) => d.productId === "800011")?.why).toMatch(/adds oats/);
    const plant = map.alternatives("800011", { use: "sauce" })!; // and from oat to dairy: not vegan
    expect(ids(plant.substitutes)).toEqual([]);
    expect(plant.none).toMatch(/vegan/);
  });

  it("returns none, with a plain reason, instead of padding", () => {
    const none = map.alternatives("800010", { use: "whipping" })!;
    expect(none.substitutes).toEqual([]);
    expect(none.none).toMatch(/No substitute for whipping that is also lactose-free, vegan: of \d+ related products, \d+ not vegan by data/);
  });

  it("for pizza, a cheese that does not melt is not served", () => {
    const r = map.alternatives("800030", { use: "pizza" })!;
    expect([...ids(r.substitutes), ...ids(r.packAlternatives)]).not.toContain("800032");
    expect(ids(r.substitutes)).toContain("800031");
    expect(ids(r.substitutes)).not.toContain("800033"); // adds walnut
  });

  it("fresh against frozen: allowed only with the condition said", () => {
    const r = map.alternatives("800040", { use: "soup" })!;
    const frozen = r.substitutes.find((s) => s.productId === "800041");
    expect(frozen?.conditions.map((c) => c.code)).toEqual(expect.arrayContaining(["frozen", "allergen_data_missing"]));
    expect(frozen?.tier).not.toBe("best");
  });

  it("a model statement cannot create a claim: profiles carry none, and facts come from the index", () => {
    const tampered = new KnowledgeMap(products, testKnowledge({ "800004": { kind: "80401.whipping_cream", uses: ["whipping"] } }));
    const r = tampered.alternatives("800001", { use: "whipping" })!;
    expect(ids(r.substitutes)).not.toContain("800004");
  });
});

describe("roles from free text", () => {
  it("cream for carbonara: creams for sauce that hold up when boiled", () => {
    const r = map.forRole("cream for carbonara");
    expect(r.uses).toContain("sauce");
    expect(r.products.length).toBeGreaterThan(0);
    expect(ids(r.products)).not.toContain("800006");
  });

  it("applies the buyer's constraints and says why when nothing fits", () => {
    const r = map.forRole("whipping cream", { constraints: { requiredClaims: ["lactose_free"] } });
    expect(ids(r.products)).not.toContain("800004");
    const none = map.forRole("cream for carbonara", { constraints: { requiredClaims: ["gluten_free"] } });
    expect(none.products).toEqual([]);
    expect(none.none).toMatch(/none meets/);
  });

  it("asks for an ingredient when given only a dish", () => {
    expect(map.forRole("for pizza").none).toMatch(/ingredient/);
  });
});

describe("file format", () => {
  it("round-trips and drops rows that do not match the vocabulary", () => {
    const data = testKnowledge();
    const file = encodeKnowledge(data);
    expect(decodeKnowledge(file).profiles).toEqual(data.profiles);
    file.rows[0][2] = "not_a_form";
    expect(decodeKnowledge(file).profiles.length).toBe(data.profiles.length - 1);
  });

  it("rejects a model answer with a kind outside its category's list or no valid use", () => {
    const ok = { id: "1", kind: "whipping_cream", form: "liquid", state: "frozen", whips: true, heat_stable: null, melts: null, sweetened: false, flavoured: false, uses: ["whipping", "bogus"] };
    expect(profileFromAnswer(ok, "80401", new Set(["whipping_cream"]))?.uses).toEqual(["whipping"]);
    expect(profileFromAnswer({ ...ok, kind: "made_up" }, "80401", new Set(["whipping_cream"]))).toBeUndefined();
    expect(profileFromAnswer({ ...ok, uses: ["bogus"] }, "80401", new Set(["whipping_cream"]))).toBeUndefined();
  });
});
