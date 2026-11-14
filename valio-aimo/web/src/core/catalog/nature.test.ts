import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSafety } from "@/server/agent/menu/safety";
import type { LiveOffer, Product } from "../catalog";
import { hardConstraints, violation } from "../clarify";
import type { Mandate } from "../mandate";
import { NeedSchema } from "../need";
import { evaluatePolicy } from "../policy";
import { buildQuote } from "../quote";
import { sampleMandate } from "../test-fixtures";
import { allergensByNature, registerNatureProfiles, type NatureProfile } from "./nature";
import { indexProduct, RawProductSchema, type IndexedProduct } from "./partner";
import { toDockProduct } from "./product";
import { allergenEvidence } from "./search";
import { rawProduct, type FixtureSpec } from "./test-data";

// Synthetic products (invented names): fresh produce without allergen data, and look-alikes that must stay unknown.
const NOW = new Date("2026-11-13T10:00:00.000Z");
const spec = (id: string, en: string, category: string, extra: Partial<FixtureSpec> = {}): FixtureSpec => ({ id, names: { en, fi: en }, salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category, allergens: [], ...extra });
const make = (s: FixtureSpec): IndexedProduct => {
  const p = indexProduct(RawProductSchema.parse(rawProduct(s)));
  return { ...p, allergens: { ...p.allergens, declared: (s.allergens ?? []).length > 0 } };
};
const onion = make(spec("990001", "Pellon yellow onion 1kg", "17405"));
const celeriac = make(spec("990002", "Pellon celeriac 1kg", "17431"));
const peeled = make(spec("990003", "Pellon peeled onion 1kg", "17405"));
const readyMeal = make(spec("990004", "Kokin vegetable stew 1kg", "17200"));
const diced = make(spec("990005", "Pellon onion 1kg", "17445"));
const PROFILES: Record<string, NatureProfile> = {
  "990001": { family: "vegetable", form: "whole", state: "fresh", kindLabel: "yellow onion" },
  "990002": { family: "vegetable", form: "whole", state: "fresh", kindLabel: "celeriac" },
  "990003": { family: "vegetable", form: "whole", state: "fresh", kindLabel: "peeled onion" },
  "990004": { family: "ready_meal", form: "mixed", state: "chilled_processed", kindLabel: "vegetable stew" },
  "990005": { family: "vegetable", form: "diced", state: "fresh", kindLabel: "diced onion" },
};

describe("allergens by nature: fresh, whole, single-ingredient produce only", () => {
  beforeEach(() => registerNatureProfiles((id) => PROFILES[id]));
  afterEach(() => registerNatureProfiles(null));

  it("a fresh whole onion contains what it is: no allergen; celeriac is celery", () => {
    expect(onion.allergens.declared).toBe(false);
    expect(allergensByNature(onion, PROFILES["990001"])).toEqual({ allergens: [], basis: "yellow onion, fresh and whole: by its nature, not declared by the maker" });
    expect(allergensByNature(celeriac, PROFILES["990002"])?.allergens).toEqual(["celery"]);
    expect(allergenEvidence(onion, "nuts")).toBe("by_nature");
    expect(allergenEvidence(celeriac, "celery")).toBe("contains");
  });

  it("anything processed, cut, mixed or outside fresh produce stays unknown", () => {
    expect(allergensByNature(peeled, PROFILES["990003"])).toBeUndefined(); // "peeled" in the name
    expect(allergensByNature(readyMeal, PROFILES["990004"])).toBeUndefined(); // a ready meal
    expect(allergensByNature(diced, PROFILES["990005"])).toBeUndefined(); // cut, not whole
    expect(allergensByNature(onion, { ...PROFILES["990001"], state: "frozen" })).toBeUndefined();
    expect(allergensByNature(onion, undefined)).toBeUndefined(); // no profile from the map: no exception
    expect(allergenEvidence(readyMeal, "nuts")).toBe("unknown");
  });

  it("the product says so, and its evidence is never the maker's declaration", () => {
    const p = toDockProduct(onion);
    expect(p.allergenInfo?.declared).toBe(false);
    expect(p.allergenInfo?.byNature?.basis).toMatch(/by its nature, not declared by the maker/);
    expect(toDockProduct(celeriac).allergens).toContain("celery");
    expect(toDockProduct(readyMeal).allergenInfo?.byNature).toBeUndefined();
  });

  it("the intake offers the onion to a nut-free kitchen, not the ready meal; declared-only keeps the strict rule", () => {
    const need = NeedSchema.parse({ item: { text: "onion" }, quantity: { amount: 10, unit: "kg" } });
    const m = sampleMandate(NOW, { allowedCategories: ["cat_17405", "cat_17431", "cat_17200"], requiredAttributes: [], forbiddenAllergens: ["nuts", "celery"] });
    const c = hardConstraints(m, need, []);
    expect(violation(toDockProduct(onion), c)).toBeUndefined();
    expect(violation(toDockProduct(celeriac), c)).toMatch(/celery/);
    expect(violation(toDockProduct(readyMeal), c)).toMatch(/no allergen data/);
    const strict = hardConstraints({ ...m, allergenEvidence: "declared" }, need, []);
    expect(violation(toDockProduct(onion), strict)).toMatch(/no allergen data/);
  });

  it("the gate passes the onion and records it as by its nature; refuses the ready meal; declared-only refuses both", () => {
    const products: Product[] = [toDockProduct(onion), toDockProduct(readyMeal)];
    const offers: LiveOffer[] = products.map((p) => ({ productId: p.id, unitPriceCents: 200, availablePacks: 100, deliveryDate: "2026-11-16" }));
    const m: Mandate = sampleMandate(NOW, { allowedCategories: ["cat_17405", "cat_17200"], requiredAttributes: [], forbiddenAllergens: ["nuts"] });
    const decide = (mandate: Mandate, id: string) => {
      const quote = buildQuote({ quoteId: "qt_n", buyerOrgId: m.issuer.orgId, agentId: m.agentId, mandateId: m.mandateId, requestId: "req_n", lines: [{ productId: id, quantity: 2 }], products, offers, now: NOW, ttlMinutes: 30 });
      return evaluatePolicy(mandate, { agentId: m.agentId, quote, lines: quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) }, { now: NOW, spentThisWeekCents: 0, quoteAlreadyUsed: false });
    };
    const ok = decide(m, "990001").rules.find((r) => r.rule === "forbidden_allergens")!;
    expect(ok.outcome).toBe("pass");
    expect(ok.reason).toMatch(/990001 by its nature, not declared by the maker/);
    expect(decide(m, "990004").rules.find((r) => r.rule === "forbidden_allergens")!.outcome).toBe("fail");
    expect(decide({ ...m, allergenEvidence: "declared" }, "990001").rules.find((r) => r.rule === "forbidden_allergens")!.outcome).toBe("fail");
  });

  it("the menu planner's safety check takes the onion by its nature and blocks celeriac for a celery rule", () => {
    const rules = { forbiddenAllergens: [{ allergen: "nuts", source: "mandate" }, { allergen: "celery", source: "mandate" }], requiredClaims: [], mandateAllergens: ["nuts", "celery"] };
    expect(checkSafety(toDockProduct(onion), rules).verdict).toBe("ok");
    expect(checkSafety(toDockProduct(onion), rules).checks[0].reason).toMatch(/by its nature/);
    expect(checkSafety(toDockProduct(celeriac), rules).verdict).toBe("block");
    expect(checkSafety(toDockProduct(readyMeal), rules).verdict).toBe("block");
    expect(checkSafety(toDockProduct(onion), { ...rules, declaredOnly: true }).verdict).toBe("block");
  });
});

describe("allergens by nature: off without the map's profiles", () => {
  it("nothing is taken by nature when no profiles are registered (tests, the seed, the crash world)", () => {
    registerNatureProfiles(null);
    expect(allergenEvidence(onion, "nuts")).toBe("unknown");
    expect(toDockProduct(onion).allergenInfo?.byNature).toBeUndefined();
  });
});
