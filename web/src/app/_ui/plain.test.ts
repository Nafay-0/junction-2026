import { describe, expect, it } from "vitest";
import { day, humanize, ruleTitle, shortProduct } from "./plain";

describe("plain words for the screens", () => {
  it("writes dates the Finnish way", () => {
    expect(day("2026-11-16")).toBe("Mon 16.11.");
  });

  it("takes internal ids and codes out of the API's sentences", () => {
    const names = { "VA-1010": "Valio Eila lactose-free semi-skimmed milk drink 1.5 %, 10 L bag-in-box" };
    expect(humanize("Gate decision on order ord_abc123: refused (weekly_budget).", names)).toBe("Gate decision on the order: refused (weekly_budget).");
    expect(humanize("Kitchen staff corrected quantity_tenfold: Make it 100 L.")).toBe("Kitchen staff corrected the amount: Make it 100 L.");
    expect(humanize("quantity_tenfold: 1,000 L where you usually order about 100 L")).toBe("1,000 L where you usually order about 100 L");
    expect(humanize("only 600 L of VA-1010 available, needed by 2026-11-16.", names)).toBe("only 600 L of Valio Eila 1.5 %, 10 L bag-in-box available, needed by Mon 16.11.");
    expect(humanize("You already ordered 100 L (ord_9f) for Thu 19 Nov.")).toBe("You already ordered 100 L for Thu 19 Nov.");
    expect(humanize("must be lactose_free")).toBe("must be lactose-free");
  });

  it("writes money and measures the Finnish way on the customer side", async () => {
    const { money, moneyShort, fiMoney, measure, num } = await import("./plain");
    expect(money(128040)).toBe("1 280,40 €");
    expect(moneyShort(50000)).toBe("500 €");
    expect(num(2.5)).toBe("2,5");
    expect(measure(1000, "L")).toBe("1 000 L");
    expect(fiMoney("Over this agent's €500 per-order limit; total €1,280.50.")).toBe("Over this agent's 500 € per-order limit; total 1 280,50 €.");
  });

  it("names every rule in plain words, with a fallback", () => {
    expect(ruleTitle("weekly_budget")).toBe("The weekly budget is a hard limit");
    expect(ruleTitle("something_new")).toBe("A rule of the gate");
    expect(shortProduct("Arla lactose-free semi-skimmed milk drink 1.5 %, 10 L bag-in-box")).toBe("Arla 1.5 %, 10 L bag-in-box");
    // The partner's names: no comma, trademark signs, long; the pack size survives the cut.
    expect(shortProduct("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free")).toBe("Valio Hyvä suomalainen Arki Eila semi…, 1 l");
    expect(shortProduct("Arla Ruoka 15%")).toBe("Arla Ruoka 15%");
  });
});
