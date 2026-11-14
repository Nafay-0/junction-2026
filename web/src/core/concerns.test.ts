import { describe, expect, it } from "vitest";
import { checkDelivery, checkDuplicate, checkNeed, checkPreferences, checkQuantity, noticeDrift, noticeNeed, noticeQuantity, type CheckContext } from "./concerns";
import { NOW, P, kitchen, past, regularHistory, statedPref } from "./kitchen-fixtures";
import type { KitchenProfile } from "./kitchen";
import { NeedSchema, applyNeedPatch, type NeedInput } from "./need";

const milkProducts = [P.box, P.box2, P.litre, P.skim, P.whole, P.organic, P.regular];
const need = (over: Partial<NeedInput> = {}) => NeedSchema.parse({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, ...over });
const ctx = (profile: KitchenProfile = kitchen(regularHistory()), over: Partial<CheckContext> = {}): CheckContext => ({ now: NOW, profile, family: "milk", candidates: milkProducts, ...over });
const L = (amount: number) => ({ quantity: { amount, unit: "L" as const } });

describe("quantity against the kitchen's own pattern", () => {
  it("a site of the kitchen (a daycare unit) is compared with its own orders, never called too small against the whole kitchen", () => {
    const history = regularHistory(); // about 100 L a time for the kitchen
    expect(noticeQuantity(need(L(15)), ctx(kitchen(history))).map((c) => c.code)).toEqual(["amount_below_usual"]); // the kitchen itself: 15 L is unusual
    expect(checkQuantity(need(L(15)), ctx(kitchen(history), { site: "Päiväkoti Satu" }))).toEqual([]); // the daycare's first order
    const daycare = [15, 15, 14, 16, 15].map((a, i) => ({ ...history[i], orderId: `ord_dc_${i}`, amount: a, site: "Päiväkoti Satu" }));
    expect(checkQuantity(need(L(150)), ctx(kitchen([...history, ...daycare]), { site: "Päiväkoti Satu" })).map((c) => c.code)).toEqual(["quantity_tenfold"]);
    // The daycare's orders do not move the kitchen's own usual amount.
    expect(checkQuantity(need(L(100)), ctx(kitchen([...history, ...daycare])))).toEqual([]);
  });

  it("catches a factor-of-ten slip upwards and offers the usual amount in one tap", () => {
    const [c, ...rest] = checkQuantity(need(L(1000)), ctx());
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({ code: "quantity_tenfold", severity: "warning", confirmable: true });
    expect(c.message).toBe("1,000 L where you usually order about 100 L: did you mean 100 L?");
    expect(c.corrections).toEqual([{ id: "use_100_L", label: "Make it 100 L", patch: { quantity: { amount: 100, unit: "L" } } }]);
    expect(applyNeedPatch(need(L(1000)), c.corrections[0].patch!).quantity).toEqual({ amount: 100, unit: "L" });
  });

  it("catches a factor-of-ten slip downwards (1 L packs, so no pack reading)", () => {
    const litres = kitchen([100, 90, 110].map((n, i) => past(P.litre, n, 20 - i * 7)));
    const [c] = checkQuantity(need(L(11)), ctx(litres));
    expect(c.code).toBe("quantity_tenfold");
    expect(c.message).toBe("11 L where you usually order about 100 L: did you mean 110 L?");
  });

  it("checks a tenfold slip against a single previous order, but not other outliers", () => {
    const one = kitchen([past(P.box, 10, 7)]);
    expect(checkQuantity(need(L(1000)), ctx(one))[0].code).toBe("quantity_tenfold");
    expect(checkQuantity(need(L(400)), ctx(one))).toEqual([]); // 4x, but one order is not a pattern
  });

  it("notes an amount clearly outside the usual on the card, and asks nothing", () => {
    expect(checkQuantity(need(L(400)), ctx())).toEqual([]); // 4x is not a likely slip: not a question
    const [n] = noticeQuantity(need(L(400)), ctx());
    expect(n).toMatchObject({ code: "amount_above_usual", params: { ratio: 4, usual: 100, unit: "L", asked: 400 } });
    expect(n.message).toBe("400 L is 4 times your usual 100 L (median of your last 8 milk orders).");
    expect(noticeQuantity(need(L(250)), ctx())[0]).toMatchObject({ code: "amount_above_usual", params: { ratio: 2.5 } });
    expect(noticeQuantity(need(L(160)), ctx())[0]).toMatchObject({ code: "amount_above_usual", params: { ratio: 1.6 } });
    expect(noticeQuantity(need(L(30)), ctx())[0]).toMatchObject({ code: "amount_below_usual" });
    for (const amount of [60, 100, 130]) expect(noticeQuantity(need(L(amount)), ctx())).toEqual([]);
    // A likely slip is asked (quantity_tenfold), never also noted.
    expect(noticeQuantity(need(L(1000)), ctx())).toEqual([]);
    expect(checkQuantity(need(L(1000)), ctx())[0].code).toBe("quantity_tenfold");
  });

  it("notes a standing order that has crept up, when it is about to be ordered again", () => {
    const creeping = kitchen([90, 95, 100, 120, 125, 130].map((n, i) => past(P.litre, n, 40 - i * 7)));
    const [d] = noticeDrift(need(L(135)), ctx(creeping));
    expect(d).toMatchObject({ code: "standing_order_drift", params: { from: 95, to: 135, unit: "L" } });
    expect(d.message).toMatch(/^Your milk order has crept up from about 95 L to 135 L over \d+ weeks\.$/);
    // Steady orders, or going back to the old level, say nothing.
    expect(noticeDrift(need(L(100)), ctx())).toEqual([]);
    expect(noticeDrift(need(L(95)), ctx(creeping))).toEqual([]);
    expect(noticeNeed(need(L(135)), ctx(creeping)).map((n) => n.code)).toContain("standing_order_drift");
  });

  it("stays quiet inside the normal range", () => {
    for (const amount of [60, 100, 130, 250]) expect(checkQuantity(need(L(amount)), ctx())).toEqual([]);
  });

  it("reads 100 packs of 10 L as a likely litres/packs mix-up, not as a tenfold slip", () => {
    const concerns = checkQuantity(need({ quantity: { amount: 100, unit: "pack" } }), ctx());
    expect(concerns).toHaveLength(1);
    expect(concerns[0].code).toBe("unit_confusion");
    expect(concerns[0].message).toBe("100 packs of 10 L is 1,000 L; you usually order about 100 L. Did you mean 100 L?");
    expect(concerns[0].corrections[0].patch).toEqual({ quantity: { amount: 100, unit: "L" } });
  });

  it("never questions a unit the product is sold in: 10 L of milk is litres, even where the kitchen usually takes 10 boxes", () => {
    expect(checkQuantity(need(L(10)), ctx()).filter((c) => c.code === "unit_confusion")).toEqual([]);
  });

  it("a count of packs with the pack size in the words is not unclear (\"5 packs of blue cheese 400 g\")", () => {
    const n = need({ quantity: { amount: 5, unit: "pack" } });
    const cheese = { ...n, item: { ...n.item, text: "Peltolan blue cheese 400 g" } };
    const cheeses = [{ ...milkProducts[0], id: "c1", unit: "kg" as const, packSize: 0.4 }, { ...milkProducts[0], id: "c2", unit: "kg" as const, packSize: 1 }];
    expect(checkQuantity(n, ctx(kitchen([]), { family: "cheese", candidates: cheeses })).map((c) => c.code)).toContain("unit_unclear"); // without the size: unclear
    expect(checkQuantity(cheese, ctx(kitchen([]), { family: "cheese", candidates: cheeses })).filter((c) => c.code === "unit_unclear")).toEqual([]);
  });

  it("treats pieces of milk as packs", () => {
    expect(checkQuantity(need({ quantity: { amount: 10, unit: "pcs" } }), ctx())).toEqual([]); // 10 boxes = 100 L, as usual
    expect(checkQuantity(need({ quantity: { amount: 100, unit: "pcs" } }), ctx())[0].code).toBe("unit_confusion");
  });

  it("cannot read a pack count without knowing the pack, and offers each reading", () => {
    const [c] = checkQuantity(need({ quantity: { amount: 10, unit: "pack" } }), ctx(kitchen()));
    expect(c).toMatchObject({ code: "unit_unclear", severity: "error", confirmable: false });
    expect(c.corrections.map((x) => x.label)).toEqual(["10 L in total", "10 packs of 1 L = 10 L", "10 packs of 10 L = 100 L"]);
  });

  it("takes litres of a family the kitchen counts in boxes, when some of its products are sold by the litre", () => {
    // The kitchen's usual is a box counted in pieces; the family also has products sold by the litre.
    const boxes = milkProducts.map((p, i) => ({ ...p, unit: i === 0 ? ("pcs" as const) : p.unit }));
    const history = regularHistory().map((h) => ({ ...h, unit: "pcs" as const }));
    expect(checkQuantity(need({ quantity: { amount: 50, unit: "L" } }), ctx(kitchen(history), { candidates: boxes as never })).filter((c) => c.code === "unit_unclear")).toEqual([]);
  });

  it("refuses a unit the family is not sold in", () => {
    const [c] = checkQuantity(need({ quantity: { amount: 100, unit: "kg" } }), ctx());
    expect(c).toMatchObject({ code: "unit_unclear", severity: "error" });
    expect(c.corrections[0].patch).toEqual({ quantity: { amount: 100, unit: "L" } });
  });

  it("asks a kitchen with no history to check a very large first order only", () => {
    const [c] = checkQuantity(need(L(1000)), ctx(kitchen()));
    expect(c).toMatchObject({ code: "large_first_order", confirmable: true });
    expect(c.corrections[0].cancel).toBe(true);
    expect(checkQuantity(need(L(200)), ctx(kitchen()))).toEqual([]);
  });
});

describe("delivery date", () => {
  it("refuses a date in the past and suggests the earliest possible one", () => {
    const [c] = checkDelivery(need({ deliverBy: "2026-11-13" }), ctx());
    expect(c).toMatchObject({ code: "delivery_in_past", severity: "error", confirmable: false });
    expect(c.corrections[0]).toMatchObject({ id: "deliver_2026-11-17", patch: { deliverBy: "2026-11-17" } });
  });

  it("refuses a non-delivery day and offers the day before and after", () => {
    const [c] = checkDelivery(need({ deliverBy: "2026-11-21" }), ctx()); // Saturday
    expect(c.code).toBe("delivery_not_delivery_day");
    expect(c.corrections.map((x) => x.patch?.deliverBy)).toEqual(["2026-11-20", "2026-11-23"]);
    // The day chosen is the day delivered: a kitchen that cannot receive on other days never gets an earlier one.
    expect(c.corrections.map((x) => x.patch?.deliverOn)).toEqual(["2026-11-20", "2026-11-23"]);
  });

  it("does not offer a day before that is already past the cut-off", () => {
    const sunday = "2026-11-22";
    const [c] = checkDelivery(need({ deliverBy: sunday }), ctx(undefined, { now: new Date("2026-11-19T12:00:00Z") })); // Thu 14:00: Fri is gone
    expect(c.corrections.map((x) => x.patch?.deliverBy)).toEqual(["2026-11-23"]);
  });

  it("refuses tomorrow after the 12:00 cut-off", () => {
    const afternoon = new Date("2026-11-16T11:30:00Z"); // Mon 13:30 Helsinki
    const [c] = checkDelivery(need({ deliverBy: "2026-11-17" }), ctx(undefined, { now: afternoon }));
    expect(c).toMatchObject({ code: "delivery_after_cutoff", corrections: [{ patch: { deliverBy: "2026-11-18" } }] });
    expect(checkDelivery(need({ deliverBy: "2026-11-17" }), ctx())).toEqual([]); // 10:00 is fine
  });

  it("respects the kitchen's own delivery days", () => {
    const twiceAWeek = { ...kitchen(), deliveryWeekdays: [1, 4] };
    expect(checkDelivery(need({ deliverBy: "2026-11-18" }), ctx(twiceAWeek))[0].corrections.map((x) => x.patch?.deliverBy)).toEqual(["2026-11-19"]); // Mon before is past cut-off
  });

  it("has nothing to say without a date", () => {
    expect(checkDelivery(need(), ctx())).toEqual([]);
  });
});

describe("duplicates", () => {
  const recent = (hoursAgo: number, neededBy = "2026-11-18") =>
    kitchen([...regularHistory(), past(P.box, 10, hoursAgo / 24, { orderId: "ord_recent", neededBy, deliveryDate: "2026-11-17" })]);

  it("flags the same family for the same delivery ordered in the last two days", () => {
    const [c] = checkDuplicate(need({ deliverBy: "2026-11-18" }), ctx(recent(3)));
    expect(c).toMatchObject({ code: "duplicate_recent", key: "duplicate_recent:ord_recent", confirmable: true });
    expect(c.message).toBe("You already ordered 100 L of milk 3 hours ago for Wed 18 Nov (order ord_recent). Order again?");
    expect(c.corrections[0].cancel).toBe(true);
  });

  it("does not flag another delivery day or an older order", () => {
    expect(checkDuplicate(need({ deliverBy: "2026-11-19" }), ctx(recent(3)))).toEqual([]);
    expect(checkDuplicate(need({ deliverBy: "2026-11-18" }), ctx(recent(72)))).toEqual([]);
  });

  it("flags an order still waiting for sign-off, and says so", () => {
    const pending = [{ orderId: "ord_wait", placedAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(), family: "milk", amount: 1000, unit: "L" as const, neededBy: "2026-11-18", deliveryDate: "2026-11-17" }];
    const [c] = checkDuplicate(need({ deliverBy: "2026-11-18" }), ctx(kitchen(regularHistory()), { pending }));
    expect(c).toMatchObject({ key: "duplicate_recent:ord_wait", evidence: { status: "pending_approval" } });
    expect(c.message).toBe("You already asked for 1,000 L of milk 2 hours ago for Wed 18 Nov (order ord_wait), and that order is still waiting for sign-off. Order again?");
    // Minutes, not "1 hour ago", for an order placed a few minutes earlier (QA wording note).
    const [soon] = checkDuplicate(need({ deliverBy: "2026-11-18" }), ctx(kitchen(regularHistory()), { pending: pending.map((p) => ({ ...p, placedAt: new Date(NOW.getTime() - 3 * 60_000).toISOString() })) }));
    expect(soon.message).toMatch(/1,000 L of milk 3 minutes ago for Wed 18 Nov/);
    expect(checkDuplicate(need({ deliverBy: "2026-11-18" }), ctx(kitchen(regularHistory()), { pending: pending.map((p) => ({ ...p, family: "cream" })) }))).toEqual([]);
  });

  it("without a date, flags a recent order that has not been delivered yet", () => {
    expect(checkDuplicate(need(), ctx(recent(3)))[0].code).toBe("duplicate_recent");
  });
});

describe("standing preferences", () => {
  const lactoseFree = statedPref({ kind: "require_claim", id: "pref_lf" });

  it("flags ordinary milk for a kitchen that is always lactose-free, and offers to keep the rule", () => {
    const n = need({ item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] } });
    const [c] = checkPreferences(n, ctx(kitchen(regularHistory(), [lactoseFree])));
    expect(c).toMatchObject({ code: "contradicts_preference", preferenceIds: ["pref_lf"], confirmable: true });
    expect(c.message).toContain('set by Aino Virtanen on Mon 2 Nov: "Always lactose-free"');
    expect(applyNeedPatch(n, c.corrections[0].patch!).item.excludedAttributes).toEqual([]);
  });

  it("flags a named product that breaks the rule", () => {
    const [c] = checkPreferences(need({ item: { text: "milk", category: "milk", productId: "T-REG" } }), ctx(kitchen([], [lactoseFree])));
    expect(c.message).toMatch(/^Milk 1.5 %, 10 L box is not lactose-free\./);
    expect(c.corrections[0].patch).toMatchObject({ item: { productId: null } });
  });

  it("is silent when the rule was set aside for this request, or applies to another family", () => {
    const n = need({ item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] } });
    expect(checkPreferences(n, ctx(kitchen([], [lactoseFree]), { suspendedPreferenceIds: ["pref_lf"] }))).toEqual([]);
    expect(checkPreferences(n, ctx(kitchen([], [{ ...lactoseFree, family: "cream" }])))).toEqual([]);
  });

  it("checks remembered answers too", () => {
    const semi = statedPref({ kind: "dimension", id: "pref_fat", dimension: "fat", choice: "fat_1_5", text: "Semi-skimmed" } as never);
    const [c] = checkPreferences(need({ item: { text: "milk", category: "milk", attributes: ["fat_free"] } }), ctx(kitchen([], [semi])));
    expect(c.message).toContain("This asks for fat-free (0.1 %).");
    expect(c.corrections[0].patch).toEqual({ item: { attributes: ["fat_1_5"], excludedAttributes: [] } });
  });

  it("does not treat a learned habit as a rule", () => {
    const n = need({ item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] } });
    expect(checkPreferences(n, ctx())).toEqual([]); // ten lactose-free orders, but nobody said "always"
  });
});

describe("checkNeed", () => {
  it("returns every concern, errors first", () => {
    const concerns = checkNeed(need({ ...L(1000), deliverBy: "2026-11-01" }), ctx());
    expect(concerns.map((c) => c.code)).toEqual(["delivery_in_past", "quantity_tenfold"]);
  });

  it("has nothing to repeat for a kitchen without that family", () => {
    const [c] = checkNeed(need({ sameAsLastTime: true }), ctx(kitchen()));
    expect(c).toMatchObject({ code: "nothing_to_repeat", severity: "error", corrections: [{ id: "show_options", patch: { sameAsLastTime: false } }] });
  });

  it("is empty for an ordinary request", () => {
    expect(checkNeed(need({ deliverBy: "2026-11-18" }), ctx())).toEqual([]);
  });
});

describe("suggested amounts in packs (QA improvement: no fractional packs)", () => {
  it("keeps a count of packs only when it is whole, else says it in litres", async () => {
    const { correctionAmount } = await import("./concerns");
    expect(correctionAmount(1105, 10, "pack", "L")).toEqual({ amount: 1105, unit: "L" }); // never "110.5 packs"
    expect(correctionAmount(1100, 10, "pack", "L")).toEqual({ amount: 110, unit: "pack" });
    expect(correctionAmount(100, undefined, "L", "L")).toEqual({ amount: 100, unit: "L" });
  });
});
