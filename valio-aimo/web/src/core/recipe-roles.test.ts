import { describe, expect, it } from "vitest";
import type { LiveStatus } from "./catalog";
import { arrivalOf, cutoffText, rankOptions, roleOf, subsFor, techniqueFor, verifyOption, type OptionToVerify, type PartCheck } from "./recipe-roles";

const ing = (key: string, name: string, searchTerms: string[] = []) => ({ key, name, searchTerms });

describe("the role an ingredient plays in the dish", () => {
  it("reads the planner's words for what it does first, then its name", () => {
    expect(roleOf("adds tang and body to the sauce", "crème fraîche")).toBe("acid");
    expect(roleOf("garnish on top", "fresh dill")).toBe("garnish");
    expect(roleOf("thickens the soup", "wheat flour")).toBe("thickener");
    expect(roleOf("for frying the onions", "butter")).toBe("fat");
    expect(roleOf("main fish", "salmon fillet")).toBe("protein");
    expect(roleOf("", "rapeseed oil")).toBe("fat");
    expect(roleOf("", "beetroot")).toBe("body");
  });
});

describe("substitutes by role, with the amount adjusted", () => {
  it("crème fraîche: smetana, sour cream, or cream with lemon at 9 to 1", () => {
    const subs = subsFor(ing("creme_fraiche", "crème fraîche", ["ranskankerma"]), "acid");
    expect(subs.map((s) => s.id)).toEqual(["creme_fraiche_smetana", "creme_fraiche_sour_cream", "creme_fraiche_cream_lemon"]);
    const lemon = subs.find((s) => s.id === "creme_fraiche_cream_lemon")!;
    expect(lemon.parts.map((p) => [p.name, p.ratio, p.main])).toEqual([
      ["cooking cream", 0.9, true],
      ["lemon juice", 0.1, false],
    ]);
  });

  it("fresh dill: frozen at the same amount, dried at a third; not for pickles", () => {
    const subs = subsFor(ing("fresh_dill", "fresh dill", ["tilli"]), "garnish");
    expect(subs.map((s) => [s.id, Math.round(s.parts[0].ratio * 100) / 100])).toEqual([
      ["dill_frozen", 1],
      ["dill_dried", 0.33],
    ]);
    expect(subsFor(ing("pickled_cucumber", "dill pickles", ["suolakurkku"]), "acid")).toEqual([]);
  });

  it("a rule tied to a role applies only in that role: oil stands in for butter for frying, not in a sauce", () => {
    expect(subsFor(ing("butter", "butter", ["voi"]), "fat").map((s) => s.id)).toContain("butter_oil");
    expect(subsFor(ing("butter", "butter", ["voi"]), "body").map((s) => s.id)).not.toContain("butter_oil");
    expect(subsFor(ing("peanut_butter", "peanut butter", ["maapähkinävoi"]), "fat")).toEqual([]);
  });

  it("a change of technique where the role allows one; none for the protein", () => {
    expect(techniqueFor("thickener", "flour")?.title).toMatch(/Reduce the sauce/);
    expect(techniqueFor("garnish", "dill")?.tradeoff.texture).toBe("a plainer look");
    expect(techniqueFor("protein", "salmon")).toBeUndefined();
  });
});

const status = (over: Partial<LiveStatus> & { offer?: LiveStatus["offer"] }): LiveStatus => ({ productId: "p1", orderable: true, problems: [], message: "", ...over });
const offer = (over: Partial<NonNullable<LiveStatus["offer"]>> = {}) => ({ productId: "p1", unitPriceCents: 500, availablePacks: 10, deliveryDate: "2026-11-16", ...over });

describe("can it arrive by the day, in the wholesaler's own terms", () => {
  it("arrives", () => {
    expect(arrivalOf(status({ offer: offer({ orderBy: "2026-11-15T17:00:00+0200" }) }), "2026-11-16")).toEqual({ ok: true, date: "2026-11-16", orderBy: "2026-11-15T17:00:00+0200" });
  });
  it("the order cut-off passed, at a time", () => {
    const a = arrivalOf(status({ problems: ["stock_unknown", "cutoff_passed"], offer: offer({ orderBy: "2026-11-12T15:00:00+0200", cutoffPassed: true }) }), "2026-11-16");
    expect(a).toMatchObject({ ok: false, code: "cutoff_passed", why: "the order cut-off passed on Thu 12.11. at 15.00 (for delivery Mon 16.11.)" });
    expect(cutoffText("2026-11-15T17:00:00+0200")).toBe("Sun 15.11. at 17.00");
  });
  it("no delivery that day: the earliest day it could come", () => {
    const a = arrivalOf(status({ problems: ["later_than_requested"], offer: offer({ deliveryDate: "2026-11-16", orderBy: "2026-11-15T17:00:00+0200" }) }), "2026-11-15");
    expect(a).toMatchObject({ ok: false, code: "later", earliest: "2026-11-16", why: "no delivery on Sun 15.11.: the earliest is Mon 16.11., ordered by Sun 15.11. at 17.00" });
  });
  it("out of stock, not deliverable at all, not checked", () => {
    expect(arrivalOf(status({ problems: ["out_of_stock"], offer: offer({ availablePacks: 0 }) }), "2026-11-16")).toMatchObject({ ok: false, code: "out_of_stock" });
    expect(arrivalOf(status({ problems: ["not_deliverable"], offer: undefined }), "2026-11-16")).toMatchObject({ ok: false, code: "not_deliverable" });
    expect(arrivalOf(undefined, "2026-11-16")).toMatchObject({ ok: false, code: "not_checked" });
  });
});

const product = (name: string, totalCents = 1000) => ({ productId: name, name, packs: 1, totalCents, packText: "1 × 1 L" });
const check = (over: Partial<PartCheck> = {}): PartCheck => ({ part: "cream", main: true, product: product("Cooking cream 1 L"), arrival: { ok: true, date: "2026-11-16" }, rules: { ok: true }, ...over });
const opt = (optionId: string, fidelity: number, checks: PartCheck[], over: Partial<OptionToVerify> = {}): OptionToVerify => ({ optionId, kind: "ingredient", title: optionId, tradeoff: { taste: "", texture: "", work: "none" }, fidelity, source: "rules", checks, deltaCents: 0, ...over });

describe("nothing unverified is shown; the rest is good, better, best", () => {
  it("fails a part that is not in the assortment, breaks a rule, or cannot arrive", () => {
    expect(verifyOption(opt("a", 1, [check()]))).toEqual({ ok: true });
    expect(verifyOption(opt("a", 1, [check({ product: undefined })]))).toEqual({ ok: false, reasons: ["cream: not found in the assortment"] });
    expect(verifyOption(opt("a", 1, [check({ rules: { ok: false, reason: "contains milk" } })]))).toMatchObject({ ok: false, reasons: [expect.stringMatching(/breaks a kitchen rule \(contains milk\)/)] });
    expect(verifyOption(opt("a", 1, [check({ arrival: { ok: false, code: "cutoff_passed", why: "the order cut-off passed" } })]))).toMatchObject({ ok: false });
    expect(verifyOption(opt("a", 1, []))).toMatchObject({ ok: false });
    // A change of technique buys nothing, so there is nothing to fail.
    expect(verifyOption(opt("t", 0.5, [], { kind: "technique" }))).toEqual({ ok: true });
  });

  it("ranks by fidelity, less for extra work and a much higher cost, and drops what failed", () => {
    const ranked = rankOptions([
      opt("smetana", 0.9, [check()]),
      opt("cream_lemon", 0.75, [check(), check({ part: "lemon", main: false })], { tradeoff: { taste: "", texture: "", work: "stir the lemon in first" } }),
      opt("pricey", 0.92, [check({ product: product("Imported crème", 4000) })], { deltaCents: 3000 }),
      opt("late", 0.99, [check({ arrival: { ok: false, code: "later", why: "later" } })]),
      opt("reduce", 0.55, [], { kind: "technique" }),
    ]);
    expect(ranked.map((r) => [r.optionId, r.rank])).toEqual([
      ["smetana", "best"],
      ["pricey", "better"],
      ["cream_lemon", "good"],
    ]);
  });
});
