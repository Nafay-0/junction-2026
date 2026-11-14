import { describe, expect, it } from "vitest";
import { originClaimInput } from "./claims";
import { SEED_PRODUCTS } from "./seed";

describe("origin claims carry traceability (data depth)", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  it("states every country of origin, the main ingredient's origin and a fish product's catch when the data has them", () => {
    const p = { ...SEED_PRODUCTS[0], countryOfOrigin: "fi", origins: ["fi", "se"], mainIngredient: { names: { en: "milk" }, pct: 98, origins: [{ stage: "MILKING", country: "fi" }] }, fish: [{ species: "SAL", latin: "Salmo salar", production: "aquaculture" as const, methods: [], areas: ["27"] }] };
    const s = originClaimInput(p, now).statement as Record<string, unknown>;
    expect(s.countriesOfOrigin).toEqual(["fi", "se"]);
    expect(s.mainIngredient).toEqual({ name: "milk", pct: 98, origins: [{ stage: "MILKING", country: "fi" }] });
    expect(s.catch).toEqual([{ species: "SAL", latin: "Salmo salar", production: "aquaculture", methods: [], areas: ["27"] }]);
  });
  it("adds nothing the data does not state", () => {
    const s = originClaimInput(SEED_PRODUCTS[0], now).statement as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(["brand", "countryOfOrigin", "labels", "vendor"]);
  });
});
