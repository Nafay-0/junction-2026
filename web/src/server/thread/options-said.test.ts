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
