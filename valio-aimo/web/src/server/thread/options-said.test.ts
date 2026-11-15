import { describe, expect, it } from "vitest";
import { optionsSaid } from "./options-said";
import type { OptionView } from "./types";

const opt = (title: string, totalCents: number, reasons: string[], lines?: string[]): OptionView =>
  ({ optionId: title, rank: "best", title, match: "full", givesUp: [], totalCents, deliveryDate: "2026-11-16", stockConfirmed: true, lines: (lines ?? [title]).map((name) => ({ productId: name, name, quantity: 1000 })), delivered: { amount: 1000, unit: "L" }, co2Kg: null, reliability: null, signOff: [], pros: [], cons: [], reasons: reasons.map((code) => ({ code, tone: "pro" as const, params: {} })), gate: { outcome: "needs_human_approval", reasons: [] } }) as OptionView;

describe("ranked options said in words", () => {
  it("names the first option with its total and why it is first, then what the others trade off (the partner's example)", () => {
    const said = optionsSaid(
      [
        opt("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free", 101_000, ["cheapest"]),
        opt("Valio semi skimmed milk 1 l lactose free UHT", 156_000, ["most_reliable"]),
        opt("Arla + Valio", 157_448, [], ["Arla Semi skimmed milkdrink 1 L UHT lactose free", "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free"]),
      ],
      "en",
    )!;
    expect(said).toMatch(/^The Valio Arki Eila is first at \*\*1 010,00 €\*\*: the cheapest that can arrive Monday 16 Nov\./);
    expect(said).toMatch(/costs 550,00 € more but delivers most reliably/);
    expect(said).toMatch(/; part Arla Semi, part Valio Arki costs 564,48 € more\.$/);
    expect(optionsSaid([opt("A", 100, ["cheapest"])], "en")).toBeUndefined();
  });
});

describe("options named so the buyer can tell them apart", () => {
  it("never a bare brand, never one name twice: the words that differ are added", async () => {
    const { optionNames } = await import("./options-said");
    const one = (name: string) => ({ title: name, lines: [{ name }] }) as never;
    expect(optionNames([one("Duni napkin 33x33cm 3-ply yellow 125 pcs"), one("Duni napkin 33x33cm 3-ply dark blue 125 pcs"), one("Duni napkin 33x33cm 3-ply granite grey 125 pcs")], "en")).toEqual(["Duni napkin yellow", "Duni napkin dark blue", "Duni napkin granite grey"]);
    const milk = optionNames([one("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free"), one("Valio Hyvä suomalainen Arki® Eila® skimmed milk drink 1 l lactose free"), one("Valio semi skimmed milk 1 l lactose free UHT")], "en");
    expect(new Set(milk.map((x) => x.toLowerCase())).size).toBe(3);
    for (const n of milk) expect(n.split(/\s+/).length, n).toBeGreaterThanOrEqual(2);
    expect(milk[0]).toBe("Valio Arki Eila semi");
    expect(milk[1]).toMatch(/^Valio Arki Eila skimmed/);
    expect(optionNames([one("Valio whipping cream 38% 1 l lactose free"), one("Valio whipping cream 38% 2 l lactose free")], "en")).toEqual(["Valio whipping cream 1 l", "Valio whipping cream 2 l"]);
    expect(optionNames([one("Eleplant plant power for cooking 2 kg"), one("Valio butter 500 g")], "en")[0]).toBe("Eleplant plant power");
  });
  it("in Finnish: the kind words in Finnish, and no double stop after the day", () => {
    const said = optionsSaid([opt("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free", 2020, ["cheapest"]), opt("Valio Hyvä suomalainen Arki® Eila® skimmed milk drink 1 l lactose free", 3120, [])].map((o) => ({ ...o, deliveryDate: "2026-11-20" })), "fi")!;
    expect(said).not.toMatch(/\.\./);
    expect(said).not.toMatch(/\b(semi|skimmed)\b/);
    expect(said).toMatch(/^Valio Arki Eila kevyt on ensimmäinen, \*\*20,20 €\*\*: edullisin, joka ehtii pe 20\.11\. Valio Arki Eila rasvaton maksaa 11,00 € enemmän\.$/);
  });
  it("the closing question names the first as the sentence does", async () => {
    const { orderAsk } = await import("./options-said");
    expect(orderAsk("Valio Arki Eila semi", "en")).toBe("Shall I order the Valio Arki Eila semi, or another one?");
  });
});

describe("a stand-in first", () => {
  it("is said as the stand-in for the usual, unless the reply says so already", () => {
    const sub = (o: OptionView) => ({ ...o, lines: o.lines.map((l) => ({ ...l, substituteFor: "usual-1" })) }) as OptionView;
    const two = [sub(opt("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free", 101_000, ["cheapest"])), opt("Valio semi skimmed milk 1 l lactose free UHT", 156_000, [])];
    expect(optionsSaid(two, "en")).toMatch(/^In place of your usual, the Valio Arki Eila is first at \*\*1 010,00 €\*\*/);
    expect(optionsSaid(two, "en", { standInSaid: true })).toMatch(/^The Valio Arki Eila is first/);
    // A kitchen with no usual (a fresh kitchen, a product the buyer named): a stand-in, never "your usual".
    expect(optionsSaid(two, "en", { usual: false })).toMatch(/^As a stand-in, the Valio Arki Eila is first at \*\*1 010,00 €\*\*/);
    expect(optionsSaid(two, "en", { usual: true })).toMatch(/^In place of your usual, the Valio Arki Eila is first/);
    expect(optionsSaid(two, "fi")).toMatch(/^Tavallisen tilalle Valio Arki Eila kevyt on ensimmäinen/);
  });
});
