import { describe, expect, it } from "vitest";
import { guardAnswerOf, guardWords } from "./guard";
import type { AnomalyCard } from "./types";

const card = (concern: AnomalyCard["concerns"][number]): AnomalyCard => ({ type: "anomaly", cardId: "anomaly:r1", requestId: "req_1", concerns: [concern] }) as AnomalyCard;
const tenfold = card({ key: "quantity_tenfold:1000:L", code: "quantity_tenfold", message: "1,000 L where you usually order about 100 L: did you mean 100 L?", confirmable: true, corrections: [{ id: "use_100_L", label: "Make it 100 L" }], evidence: { usualAmount: 100, unit: "L", basedOnOrders: 8, asked: { amount: 1000, unit: "L" } } });
const unit = card({ key: "unit_unclear:50:kg", code: "unit_unclear", message: "milk is sold by L, not by kg. Did you mean 50 L?", confirmable: false, corrections: [{ id: "use_50_L", label: "Make it 50 L" }] });
const repeat = card({ key: "duplicate_recent:ord_1a2b3c4d", code: "duplicate_recent", message: "You already ordered 200 L of milk 2 hours ago for Tue 17 Nov (order ord_1a2b3c4d). Order again?", confirmable: true, corrections: [{ id: "cancel", label: "Cancel" }], evidence: { orderId: "ord_1a2b3c4d", placedAt: "2026-11-14T10:00:00Z" } });

describe("the mistake check, said", () => {
  it("carries both figures, where the usual comes from, and one question offering the likely value", () => {
    const en = guardWords(tenfold, "en");
    expect(en).toMatch(/1\s?000/);
    expect(en).toMatch(/100\s?L/);
    expect(en).toMatch(/last 8 orders/);
    expect(en).toMatch(/Is 1\s?000\s?L right, or did you mean 100\s?L\?$/);
    expect(guardWords(tenfold, "fi")).toMatch(/tarkoititko 100/);
    expect(guardWords(unit, "en")).toMatch(/50\s?kg.*sold by the litre.*did you mean 50\s?L\?/);
    const r = guardWords(repeat, "en");
    expect(r).toMatch(/200 L/);
    expect(r).not.toMatch(/ord_/);
    const dup = card({ ...repeat.concerns[0], message: "You already ordered 2 kg of cat_10632 1 minute ago for Tue 17 Nov (order ord_9). Order again?" });
    expect(guardWords(dup, "en")).not.toMatch(/cat_|cat \d/);
    const day = card({ key: "delivery_not_delivery_day:2026-11-15", code: "delivery_not_delivery_day", message: "x", confirmable: false, corrections: [{ id: "deliver_2026-11-16", label: "Next" }], evidence: { deliverBy: "2026-11-15" } });
    expect(guardWords(day, "en")).toMatch(/Shall I make it Mon 16 Nov\?$/);
  });

  it("takes the answer in words: the corrected figure, a yes with the figure, or a reason that means yes", () => {
    expect(guardAnswerOf(tenfold, "100")?.action).toMatchObject({ choice: "use_100_L" });
    expect(guardAnswerOf(tenfold, "yes, 1 000")?.action).toMatchObject({ choice: "confirm" });
    const event = guardAnswerOf(tenfold, "it's for an event");
    expect(event?.action).toMatchObject({ choice: "confirm" });
    expect(event?.reason).toBe("it's for an event");
    expect(guardAnswerOf(unit, "50 L")?.action).toMatchObject({ choice: "use_50_L" });
  });

  it("settles a pack question with the pack in words: '5 packs of 400 g' is the 2 kg reading", () => {
    const packs = card({ key: "unit_unclear:5:pack", code: "unit_unclear", message: "5 packs of Peltolan blue cheese: packs come in 0,4 kg, 1 kg, so the amount is unclear.", confirmable: false, corrections: [{ id: "use_5_kg", label: "5 kg in total" }, { id: "use_2_kg", label: "5 packs of 0,4 kg = 2 kg" }, { id: "use_5_kg", label: "5 packs of 1 kg = 5 kg" }] });
    expect(guardAnswerOf(packs, "yes, 5 packs of 400 g")?.action).toMatchObject({ choice: "use_2_kg" });
    expect(guardAnswerOf(packs, "5 x 0,4 kg")?.action).toMatchObject({ choice: "use_2_kg" });
  });
});
