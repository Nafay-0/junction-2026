import { describe, expect, it } from "vitest";
import { SEASON, helsinkiMonth, inSeason, seasonFor, seasonMatches } from "./season";

const p = (name: string, category = "cat_1", names?: { en?: string; fi?: string; sv?: string }) => ({ name, category, names });

describe("the Finnish season calendar", () => {
  it("has a source, a reason and valid months for every entry, and unique kinds", () => {
    expect(new Set(SEASON.map((e) => e.kind)).size).toBe(SEASON.length);
    for (const e of SEASON) {
      expect(e.source.url).toMatch(/^https:\/\//);
      expect(e.why.length).toBeGreaterThan(20);
      expect(e.months.length).toBeGreaterThan(0);
      for (const m of [...e.months, ...(e.peak ?? [])]) expect(m >= 1 && m <= 12).toBe(true);
      for (const m of e.peak ?? []) expect(e.months).toContain(m);
      expect(e.match.categories?.length || e.match.words?.length).toBeTruthy();
    }
  });

  it("matches by any of the product's names, and not on a ruled-out word", () => {
    const cray = SEASON.find((e) => e.kind === "crayfish")!;
    expect(seasonMatches(cray, p("Signal crayfish, whole, frozen"))).toBe(true);
    expect(seasonMatches(cray, p("Prawns", "cat_1", { fi: "Katkarapu 1 kg" }))).toBe(false);
    const roots = SEASON.find((e) => e.kind === "root_vegetables")!;
    expect(seasonMatches(roots, p("Item 123", "cat_1", { fi: "Punajuuri kuutio 10 mm" }))).toBe(true);
  });

  it("a whole category, and words only within a category", () => {
    const cream = p("Lactose-free whipping cream 35 %, 1 L", "cream");
    expect(seasonFor(cream, 12).map((e) => e.kind)).toContain("christmas_cream");
    expect(seasonFor(cream, 2).map((e) => e.kind)).toEqual(["shrove_cream"]);
    expect(seasonFor(p("Whipping cream cake", "cat_cake"), 2)).toEqual([]);
    expect(seasonFor(cream, 7)).toEqual([]);
  });

  it("knows November in Helsinki", () => {
    expect(helsinkiMonth(new Date("2026-11-30T22:30:00Z"))).toBe(12); // already December in Helsinki
    expect(inSeason(11).map((e) => e.kind)).toEqual(expect.arrayContaining(["root_vegetables", "moose", "christmas_cream", "christmas_party"]));
    expect(inSeason(11).map((e) => e.kind)).not.toContain("strawberry");
  });
});
