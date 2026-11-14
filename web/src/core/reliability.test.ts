import { describe, expect, it } from "vitest";
import { backupCandidates, chooseForKitchen, deliveryRecordOf, poorRecords, RELIABILITY_WARN } from "./reliability";
import type { RankedSubstitute } from "./watch";

const rec = (deliveryReliability: number, deliveryReliabilityKnown?: boolean) => ({ deliveryReliability, ...(deliveryReliabilityKnown === undefined ? {} : { deliveryReliabilityKnown }) });

describe("a product's delivery record, in a chef's words", () => {
  it("history in tenths, never a forecast", () => {
    expect(deliveryRecordOf(rec(0.7))).toMatchObject({ n: 7, of: 10, poor: true, words: "has arrived as ordered about 7 times in 10" });
    expect(deliveryRecordOf(rec(0.576))).toMatchObject({ n: 6, of: 10, poor: true });
  });
  it("a poor record that tenths would round up to 9 is said in twentieths", () => {
    expect(deliveryRecordOf(rec(0.88))).toMatchObject({ n: 18, of: 20, poor: true, words: "has arrived as ordered about 18 times in 20" });
    expect(deliveryRecordOf(rec(0.86))).toMatchObject({ n: 17, of: 20 });
  });
  it("a good record is not poor; no figure is never flagged", () => {
    expect(deliveryRecordOf(rec(0.95))).toMatchObject({ n: 10, poor: false });
    expect(deliveryRecordOf(rec(0.9))!.poor).toBe(false);
    expect(deliveryRecordOf(rec(0))).toBeUndefined();
    expect(deliveryRecordOf(rec(0.5, false))).toBeUndefined();
    expect(RELIABILITY_WARN).toBe(0.9);
  });
  it("the poor products on an order, worst first", () => {
    const lines = [{ product: { id: "a", ...rec(0.88) } }, { product: { id: "b", ...rec(0.99) } }, { product: { id: "c", ...rec(0.6) } }, { product: { id: "d", ...rec(0, false) } }];
    expect(poorRecords(lines).map((l) => l.product.id)).toEqual(["c", "a"]);
  });
});

describe("backup candidates", () => {
  const sub = (productId: string, insidePreferences: boolean): RankedSubstitute => ({ rank: "best", productId, name: productId, insidePreferences, outside: insidePreferences ? [] : ["dearer"], tradeOff: {} as never, why: "" });
  const record = deliveryRecordOf(rec(0.7))!;
  const records: Record<string, number> = { worse: 0.6, better: 0.98, unknown: 0 };
  it("only alternatives with a better record (or none stated), re-ranked good, better, best", () => {
    const out = backupCandidates(record, [sub("worse", true), sub("better", false), sub("unknown", true)], (id) => deliveryRecordOf(rec(records[id] ?? 0)));
    expect(out.map((o) => [o.rank, o.productId])).toEqual([
      ["best", "better"],
      ["better", "unknown"],
    ]);
    expect(out[0].record?.words).toBe("has arrived as ordered about 10 times in 10");
  });
  it("you choose: the best inside the kitchen's preferences, or none", () => {
    expect(chooseForKitchen([sub("x", false), sub("y", true)])?.productId).toBe("y");
    expect(chooseForKitchen([sub("x", false)])).toBeUndefined();
  });
});
