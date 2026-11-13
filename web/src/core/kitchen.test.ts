import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  InMemoryKitchenRepository,
  addStatedPreference,
  beforeCutoff,
  earliestDeliveryDay,
  isoWeekday,
  kitchenView,
  lastOrder,
  learnPreferences,
  localNow,
  recordOrder,
  usualAmount,
} from "./kitchen";
import { NOW, P, kitchen, past, regularHistory, statedPref } from "./kitchen-fixtures";
import { NeedSchema, applyNeedPatch, describeNeed } from "./need";

describe("memory of a returning kitchen", () => {
  it("knows the usual amount (median of recent orders) and the last order per family", () => {
    const k = kitchen(regularHistory());
    expect(usualAmount(k, "milk")).toEqual({ amount: 100, unit: "L", orders: 8 });
    expect(lastOrder(k, "milk")?.lines[0].productId).toBe("U-BOX");
    expect(usualAmount(k, "cream")).toBeUndefined();
  });

  it("learns habits with their evidence once three orders agree", () => {
    const learned = learnPreferences(kitchen(regularHistory()), "milk");
    expect(learned.map((l) => [l.kind, "choice" in l ? l.choice : "productId" in l ? l.productId : ""])).toEqual([
      ["dimension", "lactose_free"],
      ["dimension", "fat_1_5"],
      ["dimension", "none"], // not organic
      ["product", "T-BOX"],
    ]);
    const product = learned.find((l) => l.kind === "product")!;
    expect(product.evidence).toMatchObject({ matching: 9, total: 10 });
    expect(product.text).toBe("Usually Lactose-free milk 1.5 %, 10 L box: 9 of your last 10 milk orders");
  });

  it("learns nothing from one or two orders, or from a 60/40 split", () => {
    expect(learnPreferences(kitchen([past(P.box, 10, 7), past(P.box, 10, 3)]), "milk")).toEqual([]);
    const mixed = kitchen([past(P.box, 10, 20), past(P.skim, 100, 16), past(P.box, 10, 12), past(P.skim, 100, 8), past(P.box, 10, 4)]);
    const kinds = learnPreferences(mixed, "milk").map((l) => ("dimension" in l ? l.dimension : l.kind));
    expect(kinds).not.toContain("fat");
    expect(kinds).not.toContain("product");
    expect(kinds).toContain("lactose");
  });

  it("learns what the kitchen chooses by", () => {
    const h = [3, 2, 1].map((d) => past(P.box, 10, d * 7, { chosenLabels: ["best_price", "lowest_carbon"] }));
    expect(learnPreferences(kitchen(h), "milk").find((l) => l.kind === "optimise")).toMatchObject({ goal: "price", evidence: { matching: 3, total: 3 } });
  });

  it("records orders idempotently and keeps a bounded history", () => {
    let k = kitchen();
    const e = past(P.box, 10, 1);
    k = recordOrder(recordOrder(k, e), e);
    expect(k.history).toHaveLength(1);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) k = recordOrder(k, { ...e, orderId: `o${i}`, placedAt: new Date(NOW.getTime() + i).toISOString() });
    expect(k.history).toHaveLength(HISTORY_LIMIT);
  });

  it("replaces a stated preference about the same thing", () => {
    let k = addStatedPreference(kitchen(), statedPref({ kind: "require_claim", id: "a" }));
    k = addStatedPreference(k, statedPref({ kind: "require_claim", id: "b" }));
    k = addStatedPreference(k, statedPref({ kind: "forbid_allergen", id: "c", allergen: "nuts" } as never));
    expect(k.stated.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("serialises: the repository hands out copies", async () => {
    const repo = new InMemoryKitchenRepository([kitchen(regularHistory())]);
    const a = (await repo.getProfile("org_laakso"))!;
    a.history.length = 0;
    expect((await repo.getProfile("org_laakso"))!.history).toHaveLength(10);
    expect(JSON.parse(JSON.stringify(kitchenView(a)))).toEqual(kitchenView(a));
  });

  it("shows families, usual amounts and learned habits in the profile view", () => {
    const v = kitchenView(kitchen(regularHistory()));
    expect(v.families[0]).toMatchObject({ family: "milk", orders: 10, usual: { text: "usually about 100 L" } });
    expect(v.families[0].learned.length).toBeGreaterThan(0);
  });
});

describe("delivery calendar (Helsinki time)", () => {
  it("reads local time across daylight saving", () => {
    expect(localNow(new Date("2026-11-16T08:00:00Z"))).toEqual({ date: "2026-11-16", time: "10:00" });
    expect(localNow(new Date("2026-06-15T21:30:00Z"))).toEqual({ date: "2026-06-16", time: "00:30" });
  });

  it("knows weekdays and the 12:00 cut-off the day before", () => {
    expect(isoWeekday("2026-11-16")).toBe(1);
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(beforeCutoff("2026-11-17", new Date("2026-11-16T09:59:00Z"))).toBe(true); // 11:59
    expect(beforeCutoff("2026-11-17", new Date("2026-11-16T10:00:00Z"))).toBe(false); // 12:00
  });

  it("finds the earliest delivery day", () => {
    expect(earliestDeliveryDay(NOW, [1, 2, 3, 4, 5])).toBe("2026-11-17");
    expect(earliestDeliveryDay(new Date("2026-11-16T11:00:00Z"), [1, 2, 3, 4, 5])).toBe("2026-11-18");
    expect(earliestDeliveryDay(new Date("2026-11-20T11:00:00Z"), [1, 2, 3, 4, 5])).toBe("2026-11-23"); // Fri afternoon: Monday
    expect(earliestDeliveryDay(NOW, [])).toBeUndefined();
  });
});

describe("structured need", () => {
  it("fills defaults and validates", () => {
    const n = NeedSchema.parse({ item: { text: "milk" }, quantity: { amount: 100, unit: "L" } });
    expect(n).toMatchObject({ requiredClaims: [], forbiddenAllergens: [], optimise: "unstated", sameAsLastTime: false, item: { attributes: [], excludedAttributes: [] } });
    expect(NeedSchema.safeParse({ item: { text: "milk" } }).success).toBe(false); // no quantity
    expect(NeedSchema.safeParse({ item: { text: "milk" }, sameAsLastTime: true }).success).toBe(true);
    expect(NeedSchema.safeParse({ item: { text: "milk" }, quantity: { amount: -1, unit: "L" } }).success).toBe(false);
    expect(NeedSchema.safeParse({ item: { text: "milk" }, quantity: { amount: 1, unit: "barrel" } }).success).toBe(false);
    expect(NeedSchema.safeParse({ item: { text: "milk", attributes: ["organic"], excludedAttributes: ["organic"] }, quantity: { amount: 1, unit: "L" } }).success).toBe(false);
  });

  it("applies one-tap patches, with null removing a field", () => {
    const n = NeedSchema.parse({ item: { text: "milk", productId: "X" }, quantity: { amount: 1000, unit: "L" }, deliverBy: "2026-11-18" });
    const p = applyNeedPatch(n, { quantity: { amount: 100, unit: "L" }, deliverBy: null, item: { productId: null } });
    expect(p.quantity).toEqual({ amount: 100, unit: "L" });
    expect(p.deliverBy).toBeUndefined();
    expect(p.item.productId).toBeUndefined();
    expect(n.quantity!.amount).toBe(1000); // not mutated
  });

  it("describes itself in one line", () => {
    const n = NeedSchema.parse({ item: { text: "milk", attributes: ["fat_1_5"] }, quantity: { amount: 100, unit: "L" }, requiredClaims: ["lactose_free"], deliverBy: "2026-11-18", optimise: "co2" });
    expect(describeNeed(n)).toBe("100 L of milk; must be lactose_free, fat_1_5; deliver by 2026-11-18; optimise: co2");
  });
});

describe("Helsinki calendar days (F-GATE-UTC-DATE)", () => {
  it("counts lead days and history dates in Helsinki, across midnight and the end of summer time", async () => {
    const { latestDeliveryDay, localDateOf } = await import("./kitchen");
    expect(latestDeliveryDay(new Date("2026-11-13T22:30:00Z"), 5)).toBe("2026-11-19"); // 00:30 Sat in Helsinki
    expect(latestDeliveryDay(new Date("2026-11-13T21:30:00Z"), 5)).toBe("2026-11-18"); // 23:30 Fri
    expect(latestDeliveryDay(new Date("2026-10-24T21:30:00Z"), 5)).toBe("2026-10-30"); // 00:30 Sun, summer time
    expect(localDateOf("2026-11-13T22:30:00.000Z")).toBe("2026-11-14");
  });
});
