import { describe, expect, it } from "vitest";
import { differencesOf, keyOf, optionDifferences, sayDifferences } from "./differences";

const ctx = { lang: "en" as const, allowedGroups: ["dairy and cheese", "bakery"] };

describe("nothing is left out, swapped, reduced or moved silently", () => {
  it("an amount in kilos of a product sold in packs is said in packs and in kilos", () => {
    const d = optionDifferences({ key: "r1", name: "Vaasan rye rice pies", amount: { amount: 16, unit: "kg" } }, { delivered: { amount: 16.2, unit: "kg" }, pack: { count: 2, size: 8.1, unit: "kg" } });
    expect(sayDifferences(d, ctx).said).toBe("Vaasan rye rice pies come in packs of 8,1 kg: 2 packs are 16,2 kg rather than 16 kg.");
  });

  it("an ingredient outside the kitchen's product groups is said with the rule, where it comes from, and the ways forward", () => {
    const d = differencesOf(
      [
        { key: "mince", name: "Beef and pork mince" },
        { key: "butter", name: "Butter" },
        { key: "eggs", name: "Eggs" },
      ],
      [{ key: "mince", out: true, reason: { code: "rules_groups", categories: ["meat"] } }, { key: "butter" }, { key: "eggs" }],
    );
    expect(d).toEqual([{ kind: "left_out", key: "mince", name: "Beef and pork mince", reason: { code: "rules_groups", categories: ["meat"] } }]);
    const s = sayDifferences(d, { ...ctx, canAskOwner: true, dish: { toBuy: 3, buyable: ["Butter", "Eggs"] } });
    expect(s.said).toMatch(/only buy 2 of the 3 ingredients/);
    expect(s.said).toMatch(/Your rules \(the kitchen's product groups: dairy and cheese and bakery\) don't cover beef and pork mince\./);
    expect(s.ask).toBe("Shall I ask the owner to add them, order just the butter and eggs, or plan a dish I can buy completely?");
  });

  it("an item the wholesaler does not sell", () => {
    const d = differencesOf([{ key: "truffle", name: "Truffle oil" }], [{ key: "truffle", out: true, reason: { code: "not_sold" } }]);
    expect(sayDifferences(d, ctx).said).toBe("The wholesaler doesn't sell truffle oil.");
  });

  it("an item past its order cut-off", () => {
    const d = differencesOf([{ key: "cream", name: "Cooking cream", day: "2026-11-17" }], [{ key: "cream", out: true, reason: { code: "cannot_arrive", day: "2026-11-17" } }]);
    expect(sayDifferences(d, ctx).said).toBe("Cooking cream can't arrive in time for Tuesday 17 Nov: the order time has passed.");
  });

  it("an amount rounded up to whole packs", () => {
    const d = optionDifferences({ key: "r1", name: "Lactose-free milk", amount: { amount: 25, unit: "L" } }, { delivered: { amount: 30, unit: "L" } });
    expect(d).toMatchObject([{ kind: "rounded_up", from: { amount: 25 }, to: { amount: 30 } }]);
    expect(sayDifferences(d, ctx).said).toBe("Lactose-free milk: 30 l rather than 25 l, the nearest whole packs.");
  });

  it("a day moved later than asked, and a delivery earlier than a by-day is not a difference", () => {
    const later = optionDifferences({ key: "r1", name: "Whipping cream", day: "2026-11-17" }, { deliveryDate: "2026-11-18" });
    expect(later).toMatchObject([{ kind: "moved_day", from: "2026-11-17", to: "2026-11-18" }]);
    expect(sayDifferences(later, ctx).said).toBe("Whipping cream comes Wednesday 18 Nov, not Tuesday 17 Nov.");
    expect(optionDifferences({ key: "r1", name: "Whipping cream", day: "2026-11-17" }, { deliveryDate: "2026-11-16" })).toEqual([]);
    expect(optionDifferences({ key: "r1", name: "Whipping cream", day: "2026-11-17", exact: true }, { deliveryDate: "2026-11-16" })).toMatchObject([{ kind: "moved_day" }]);
  });

  it("a substitute the engine chose is said on the item it replaces", () => {
    const d = optionDifferences({ key: "r1", name: "Lactose-free milk 1 l" }, { substituteFor: "p1", title: "Valio Hyvä suomalainen Arki 1 l" });
    expect(sayDifferences(d, ctx).said).toBe("Lactose-free milk 1 l: Valio Hyvä suomalainen Arki 1 l in its place.");
  });

  it("a difference without a reason is said as such and returned as a defect, never skipped", () => {
    const d = differencesOf([{ key: "x", name: "Cream" }], []);
    const s = sayDifferences(d, ctx);
    expect(s.said).toBe("I couldn't find out why cream is left off.");
    expect(s.unknown.map(keyOf)).toEqual(["left_out:x:unknown"]);
  });

  it("an amount reduced below what was asked", () => {
    const d = differencesOf([{ key: "m", name: "Milk", need: { amount: 1000, unit: "L" } }], [{ key: "m", amount: { amount: 420, unit: "L" } }]);
    expect(sayDifferences(d, ctx).said).toBe("Milk: only 420 l of the 1000 l you asked for.");
  });
});
