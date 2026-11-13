import { describe, expect, it } from "vitest";
import { addFacts, checkSpeech, emptyFacts, numbersIn } from "./grounding";

const toolResult = {
  ok: true,
  state: "options_ready",
  say: "Dock found 2 options, shown on the screen. Option 1 (Best price): 100 x 10 L Lactose-free milk drink 1.5%, €1,570.31, delivered Monday 16 November; meets the whole request. Option 2: 1000 x 1 L Eila milk, €1,400.00, delivered Tuesday 17 November.",
  options: [
    { optionId: "opt_1", total: "€1,570.31", delivery: "Monday 16 November", orderBy: "Sun 15 Nov 17:00", products: ["100 x 10 L Lactose-free milk drink 1.5%"] },
    { optionId: "opt_2", total: "€1,400.00", delivery: "Tuesday 17 November", products: ["1000 x 1 L Eila milk"] },
  ],
  deliveryDate: "2026-11-16",
  later: "2026-11-17",
  totalCents: 157031,
};

const facts = () => addFacts(emptyFacts(), toolResult);
const BRANDS = ["Valio", "Arla", "Eila", "Oatly"];

describe("numbersIn", () => {
  it("reads digits in the forms speech transcripts use", () => {
    expect(numbersIn("1,000 L and 12,40 € and 2.5 kg and 1 000 litres").map((n) => n.value)).toEqual([1000, 12.4, 2.5, 1000]);
  });
  it("reads number words in English, Finnish and Swedish", () => {
    expect(numbersIn("one thousand litres").map((n) => n.value)).toEqual([1000]);
    expect(numbersIn("kaksisataa litraa").map((n) => n.value)).toEqual([200]);
    expect(numbersIn("tvåhundra liter").map((n) => n.value)).toEqual([200]);
    expect(numbersIn("fifty-five kilos").map((n) => n.value)).toEqual([55]);
  });
});

describe("checkSpeech", () => {
  it("passes speech that only repeats the tool result, in any of the three languages", () => {
    const f = facts();
    expect(checkSpeech("Option 1 is 100 packs of 10 litres for 1,570.31 euros, delivered Monday 16 November.", f, { brands: BRANDS, final: true })).toEqual([]);
    expect(checkSpeech("Vaihtoehto 2: 1000 litraa Eila-maitoa, 1 400 euroa, toimitus tiistaina 17.11.", f, { brands: BRANDS, final: true })).toEqual([]);
    expect(checkSpeech("Alternativ 1 kostar 1570 euro och levereras på måndag.", f, { brands: BRANDS, final: true })).toEqual([]);
    expect(checkSpeech("There are two options. Which one do you want, 1 or 2?", f, { brands: BRANDS, final: true })).toEqual([]);
  });

  it("flags a price, an amount, a date, a time or a brand that no tool returned", () => {
    const f = facts();
    expect(checkSpeech("That comes to €1,250.00.", f, { final: true })).toEqual([{ kind: "price", said: "1,250.00" }]);
    expect(checkSpeech("I can get you 800 litres.", f, { final: true })).toEqual([{ kind: "number", said: "800" }]);
    expect(checkSpeech("It arrives on Thursday.", f, { final: true })).toEqual([{ kind: "date", said: "thursday" }]);
    expect(checkSpeech("Order by 14:00 today.", f, { final: true })).toEqual([{ kind: "time", said: "14:00" }]);
    expect(checkSpeech("I would go for the Arla one.", f, { brands: BRANDS, final: true })).toEqual([{ kind: "product", said: "Arla" }]);
    expect(checkSpeech("Toimitus perjantaina, hinta kaksisataa euroa.", f, { final: true }).map((v) => v.kind).sort()).toEqual(["date", "price"]);
  });

  it("allows the times and dates the tool gave", () => {
    expect(checkSpeech("Order by 17:00 on Sunday for Monday delivery.", facts(), { final: true })).toEqual([]);
  });

  it("does not judge a number that may still be arriving", () => {
    expect(checkSpeech("The total is 1,2", facts(), { final: false })).toEqual([]);
  });

  it("rounds money the way people say it", () => {
    expect(checkSpeech("About 1,570 euros.", facts(), { final: true })).toEqual([]);
  });
});
