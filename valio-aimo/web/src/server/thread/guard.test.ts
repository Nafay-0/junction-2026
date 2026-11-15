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

  it("names the pack readings, the first as the one to take, and a plain yes takes it", () => {
    const c = card({ key: "unit_unclear:2:pack", code: "unit_unclear", message: "x", confirmable: false, corrections: [{ id: "use_2_kg", label: "2 kg in total" }, { id: "use_1_kg", label: "2 packs of 0.5 kg = 1 kg" }, { id: "use_4_kg", label: "2 packs of 2 kg = 4 kg" }] });
    expect(guardWords(c, "en")).toBe("The packs come in several sizes. Shall I take 2 packs of 0,5 kg (1 kg), or 2 packs of 2 kg (4 kg)?");
    expect(guardAnswerOf(c, "yes")?.action).toMatchObject({ choice: "use_1_kg" });
  });

  it("counts pieces into packs, and a yes or the figure again takes that reading", () => {
    const c = card({ key: "unit_unclear:40:pcs", code: "unit_unclear", message: "x", confirmable: false, corrections: [{ id: "use_3.2_kg", label: "4 packs of 10 pcs (3,2 kg)" }], evidence: { pieces: 40, perPack: 10, packs: 4 } });
    expect(guardWords(c, "en")).toMatch(/^40 pieces: a pack holds 10, so that is 4 packs \(3,2\s?kg\)\. Shall I order them\?$/);
    expect(guardAnswerOf(c, "yes")?.action).toMatchObject({ choice: "use_3.2_kg" });
    expect(guardAnswerOf(c, "40 pcs is right")?.action).toMatchObject({ choice: "use_3.2_kg" });
  });

  it("says a pack reading with the pack's size and the total, never a bare '20 packs'", () => {
    const c = card({ key: "unit_confusion:20:L", code: "unit_confusion", message: "20 L is what you usually order in packs: 20 packs of 20 L = 400 L. Did you mean 20 packs?", confirmable: true, corrections: [{ id: "use_20_pack", label: "Make it 20 packs (400 L)" }], evidence: { usualAmount: 400, unit: "L", basedOnOrders: 6, asked: { amount: 20, unit: "L" }, packSize: 20 } });
    const en = guardWords(c, "en");
    expect(en).toMatch(/You usually order about 400\s?l/i);
    expect(en).toMatch(/did you mean 20 packs of 20\s?l \(400\s?l\)\?$/i);
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

describe("the delivery-day check, answered in words", () => {
  const day = card({ key: "delivery_not_delivery_day:2026-11-19", code: "delivery_not_delivery_day", message: "x", confirmable: false, corrections: [{ id: "deliver_2026-11-17", label: "The delivery day before: Tue 17 Nov" }, { id: "deliver_2026-11-20", label: "The next delivery day: Fri 20 Nov" }], evidence: { deliverBy: "2026-11-19" } });
  it("a yes takes the day the question offered, never another one", () => {
    expect(guardWords(day, "en")).toMatch(/Shall I make it Fri 20 Nov\?$/);
    for (const w of ["yes", "yes, order it", "yes please", "kyllä", "ja tack"]) expect(guardAnswerOf(day, w)?.action, w).toMatchObject({ type: "concern", choice: "deliver_2026-11-20" });
  });
  it("a weekday named takes the day offered on it, in any of the three languages", () => {
    expect(guardAnswerOf(day, "deliver it on Tuesday instead")?.action).toMatchObject({ choice: "deliver_2026-11-17" });
    expect(guardAnswerOf(day, "Friday then")?.action).toMatchObject({ choice: "deliver_2026-11-20" });
    expect(guardAnswerOf(day, "tiistaina")?.action).toMatchObject({ choice: "deliver_2026-11-17" });
    expect(guardAnswerOf(day, "på fredag")?.action).toMatchObject({ choice: "deliver_2026-11-20" });
  });
  it("an amount, a no, or a day not offered is not an answer to it", () => {
    expect(guardAnswerOf(day, "make it 15 litres")).toBeUndefined();
    expect(guardAnswerOf(day, "no, keep Thursday")).toBeUndefined();
    expect(guardAnswerOf(day, "go to the shop")).toBeUndefined();
  });
});

describe("the pack-size check", () => {
  it("names what comes in those sizes", () => {
    const c = card({ key: "unit_unclear:40:pcs", code: "unit_unclear", message: "40 pcs of red wine: packs come in 0.22 L, 1 L, 1.5 L, so the amount is unclear.", confirmable: false, corrections: [{ id: "use_40_L", label: "40 L in total" }, { id: "use_8.8_L", label: "40 pcs of 0.22 L = 8.8 L" }, { id: "use_60_L", label: "40 pcs of 1.5 L = 60 L" }] });
    expect(guardWords(c, "en")).toBe("Red wine comes in several pack sizes. Shall I take 40 pcs of 0,22 L (8,8 L), or 40 pcs of 1,5 L (60 L)?");
  });
});

describe("an amount said in words", () => {
  it("is the number, in three languages; small words are not amounts", async () => {
    const { spelledAmount } = await import("./guard");
    expect(spelledAmount("No, make it two hundred")).toBe(200);
    expect(spelledAmount("five hundred and fifty litres")).toBe(550);
    expect(spelledAmount("a thousand")).toBe(1000);
    expect(spelledAmount("ei, kaksisataa")).toBe(200);
    expect(spelledAmount("nej, tvåhundra liter")).toBe(200);
    expect(spelledAmount("the first one")).toBeUndefined();
    expect(spelledAmount("two packs")).toBeUndefined();
    for (const sure of ["I'm a hundred percent sure", "yes, one hundred per cent", "sata prosenttia varma", "hundra procent säker"]) expect(spelledAmount(sure), sure).toBeUndefined();
  });
  it("then answers the check by its figure when the figure is offered", () => {
    expect(guardAnswerOf(tenfold, "no, one hundred (100 L)")?.action).toMatchObject({ choice: "use_100_L" });
  });
});
