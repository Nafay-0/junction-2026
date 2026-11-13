import { describe, expect, it } from "vitest";
import { checkNeed, relatedFamilies, type CheckContext } from "@/core/concerns";
import { type KitchenProfile, type MemoryItem } from "@/core/kitchen";
import { NOW, P, kitchen, past, regularHistory } from "@/core/kitchen-fixtures";
import { NeedSchema, type NeedInput } from "@/core/need";
import { effort, runBench } from "./bench";
import { recordedProposer } from "./propose";
import { RECORDINGS } from "./recordings";
import { BENCH_KITCHENS } from "./scenarios";

/** Mistake checks from memory: each says why in the kitchen's own terms, cites what it rests on, and offers the likely intended version. */

const need = (over: Partial<NeedInput> = {}) => NeedSchema.parse({ item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: "2026-11-18", ...over });
const ctx = (profile: KitchenProfile, family = "milk"): CheckContext => ({ now: NOW, profile, family, candidates: Object.values(P).filter((p) => p.category === family) });
const item = (over: Partial<MemoryItem> & Pick<MemoryItem, "fact" | "text">): MemoryItem => ({
  id: "mem_1",
  strength: "habit",
  origin: "inferred",
  status: "active",
  audience: "shared",
  safety: false,
  weight: 0.8,
  confirmations: 2,
  contradictions: 0,
  sources: [{ door: "typed", at: "2026-11-03T09:00:00.000Z", by: "Sanna Koskinen", quote: "the Saaristo one, always" }],
  createdAt: "2026-11-03T09:00:00.000Z",
  updatedAt: "2026-11-03T09:00:00.000Z",
  history: [],
  ...over,
});
const withMemory = (p: KitchenProfile, items: MemoryItem[]): KitchenProfile => ({ ...p, memory: { items, forgotten: [], staffReads: [], proposals: [] } });
const codes = (p: KitchenProfile, n = need(), family = "milk") => checkNeed(n, ctx(p, family)).map((c) => c.code);

describe("anomaly explanations from memory", () => {
  it("names a substitute the kitchen turned down, who said so, when and why, and offers the usual", () => {
    const p = withMemory(kitchen(regularHistory()), [
      item({ id: "mem_sub", fact: { kind: "substitute", forProductId: "T-BOX", forName: "Lactose-free milk 1.5 %, 10 L box", productId: "U-BOX", name: "Other lactose-free milk", accepted: false, reason: "the porridge burns with it" }, text: "Turned down U-BOX", origin: "stated", sources: [{ door: "substitute", at: "2026-11-03T09:00:00.000Z", by: "Sanna Koskinen" }] }),
      item({ id: "mem_usual", fact: { kind: "product", productId: "T-BOX", name: "Lactose-free milk 1.5 %, 10 L box", stance: "prefer" }, text: "Prefers the T box", family: "milk" }),
    ]);
    const [c] = checkNeed(need({ item: { text: "other milk", category: "milk", productId: "U-BOX" } }), ctx(p));
    expect(c).toMatchObject({ code: "declined_before", confirmable: true, memoryItemIds: ["mem_sub"] });
    expect(c.message).toBe('Other lactose-free milk 1.5 %, 10 L box: Sanna Koskinen turned it down as a substitute for Lactose-free milk 1.5 %, 10 L box on Tue 3 Nov: "the porridge burns with it". Order it anyway?');
    expect(c.corrections.map((x) => x.id)).toEqual(["use_T-BOX", "choose_other"]);
  });

  it("calls a product a person said never to order a broken rule", () => {
    const p = withMemory(kitchen(), [item({ fact: { kind: "brand", brand: "U", stance: "avoid" }, text: "Never the U brand", strength: "rule", confirmedBy: { by: "Sanna Koskinen", at: "2026-11-03T09:00:00.000Z" } })]);
    const [c] = checkNeed(need({ item: { text: "milk", category: "milk", productId: "U-BOX" } }), ctx(p));
    expect(c.code).toBe("breaks_remembered_rule");
    expect(c.message).toContain('Remembered: Never the U brand (confirmed by Sanna Koskinen on Tue 3 Nov: "the Saaristo one, always").');
  });

  it("catches an amount far outside a standing order that the plain checks let through, and proposes the usual", () => {
    const standing = item({ fact: { kind: "standing_order", weekdays: [3], amount: 100, unit: "L", low: 90, high: 120 }, text: "Standing Wed order (milk): usually 100 L", family: "milk", origin: "learned", sources: [{ door: "order", at: "2026-11-11T08:00:00.000Z", orderId: "o1" }] });
    const p = withMemory(kitchen(regularHistory()), [standing]);
    expect(codes(kitchen(regularHistory()), need({ quantity: { amount: 190, unit: "L" } }))).toEqual([]); // 1.9x the median: below the 3x plain check
    const [c] = checkNeed(need({ quantity: { amount: 190, unit: "L" } }), ctx(p));
    expect(c).toMatchObject({ code: "standing_order_range", deferrable: true, memoryItemIds: [standing.id], corrections: [{ id: "use_100_L", patch: { quantity: { amount: 100, unit: "L" } } }] });
    expect(c.message).toMatch(/^190 L for Wed 18 Nov is 1.58x the most your standing Wed milk order takes \(normally 90 L to 120 L\)\. Remembered: .* Did you mean the usual 100 L\?$/);
    // Inside 1.5x of the range: a bigger week, not a slip. No question.
    expect(codes(p, need({ quantity: { amount: 170, unit: "L" } }))).toEqual([]);
    // A plain tenfold slip is asked once, by the plain check, not twice.
    expect(codes(p, need({ quantity: { amount: 1000, unit: "L" } }))).toEqual(["quantity_tenfold"]);
  });

  it("warns about a delivery on a day a person said the kitchen does not receive; days read from history alone do not", () => {
    const said = item({ fact: { kind: "delivery_days", weekdays: [1, 4] }, text: "Receives deliveries on Mon, Thu", sources: [{ door: "voice", at: "2026-11-03T09:00:00.000Z", by: "Sanna Koskinen", quote: "we only take deliveries Mondays and Thursdays" }] });
    const [c] = checkNeed(need(), ctx(withMemory(kitchen(), [said])));
    expect(c).toMatchObject({ code: "delivery_unusual_day", memoryItemIds: [said.id] });
    expect(c.message).toContain("receives deliveries on Mon, Thu; Wed 18 Nov is not one of them.");
    expect(c.corrections.map((x) => x.label)).toEqual(["Deliver Thu 19 Nov instead"]); // Monday 16th is today: too late
    expect(codes(withMemory(kitchen(), [{ ...said, origin: "learned" }]))).toEqual([]);
  });

  it("cites the person when a stated delivery-days rule blocks a day", () => {
    const rule = item({ fact: { kind: "delivery_days", weekdays: [1, 3, 5] }, text: "Receives deliveries on Mon, Wed, Fri", strength: "rule", confirmedBy: { by: "Leena Aho", at: "2026-11-03T09:00:00.000Z" }, derived: { deliveryWeekdaysBefore: [1, 2, 3, 4, 5] } });
    const p = { ...withMemory(kitchen(), [rule]), deliveryWeekdays: [1, 3, 5] };
    const [c] = checkNeed(need({ deliverBy: "2026-11-19" }), ctx(p));
    expect(c).toMatchObject({ code: "delivery_not_delivery_day", memoryItemIds: [rule.id] });
    expect(c.message).toContain("Remembered: Receives deliveries on Mon, Wed, Fri (confirmed by Leena Aho on Tue 3 Nov");
  });

  it("asks about a first order of a family unrelated to anything the kitchen buys, only when it is big enough to matter", () => {
    const p = kitchen(regularHistory());
    const detergent = (amount: number) => need({ item: { text: "dishwasher tablets", category: "detergent" }, quantity: { amount, unit: "pcs" } });
    expect(codes(p, detergent(200), "detergent")).toEqual(["unrelated_first_order"]);
    expect(checkNeed(detergent(200), ctx(p, "detergent"))[0].message).toBe("Laakso Catering Oy has never ordered detergent: its last 10 orders were all milk. Is detergent what you meant?");
    expect(codes(p, detergent(20), "detergent")).toEqual([]); // a few euros of tablets: not worth a stop
    expect(codes(p, need({ item: { text: "cream", category: "cream" }, quantity: { amount: 20, unit: "L" } }), "cream")).toEqual([]); // dairy: related
    expect(codes(kitchen([past(P.box, 10, 3)]), detergent(200), "detergent")).toEqual([]); // too little history to call it unrelated
    expect(relatedFamilies("41763", "41705")).toBe(true);
    expect(relatedFamilies("41763", "22630")).toBe(false);
  });

  it("raises nothing from memory for a kitchen without memory: the plain checks are unchanged", () => {
    expect(codes(kitchen(regularHistory()))).toEqual([]);
  });
});

describe("the measured effect of memory (three weeks, two kitchens, recorded model output)", () => {
  it("needs less manual work, catches the slips, and offers nothing unsafe", async () => {
    const results = await runBench(BENCH_KITCHENS, { proposer: recordedProposer(RECORDINGS) });
    const total = (mode: "off" | "on") => results.reduce((s, r) => s + effort(r[mode].counts), 0);
    const sum = (mode: "off" | "on", k: "caught" | "missed" | "unsafe" | "corrections" | "remember") => results.reduce((s, r) => s + r[mode].counts[k], 0);
    expect(total("on")).toBeLessThan(total("off"));
    expect(sum("on", "corrections")).toBe(0);
    expect(sum("on", "missed")).toBe(0);
    expect(sum("on", "unsafe")).toBe(0);
    expect(sum("off", "unsafe")).toBeGreaterThan(0);
    expect(sum("on", "caught")).toBeGreaterThan(sum("off", "caught"));
    // Asked once, never again: every "should I remember this?" is about a different thing.
    const asked = results.flatMap((r) => r.on.steps.flatMap((s) => s.questions));
    expect(new Set(asked).size).toBe(asked.length);
    expect(sum("on", "remember")).toBe(asked.length);
  });
});
