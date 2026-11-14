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
  it("reads teens and tens in Finnish and Swedish, and Swedish compounds", () => {
    expect(numbersIn("kuusitoista kiloa").map((n) => n.value)).toEqual([16]);
    expect(numbersIn("sata kaksikymmentä kananmunaa").map((n) => n.value)).toEqual([120]);
    expect(numbersIn("femton kilo, sextio liter").map((n) => n.value)).toEqual([15, 60]);
    expect(numbersIn("hundratio liter").map((n) => n.value)).toEqual([110]);
    expect(numbersIn("trettiofem liter").map((n) => n.value)).toEqual([35]);
  });
  it("reads amounts with a half or a decimal point, as people say them", () => {
    const has = (t: string, v: number) => expect(numbersIn(t).map((n) => n.value)).toContain(v);
    has("two and a half kilos of parmesan", 2.5);
    has("2 and 1/2 kilos", 2.5);
    has("one and a half litres", 1.5);
    has("kaksi ja puoli kiloa", 2.5);
    has("puolitoista litraa", 1.5);
    has("två och ett halvt kilo", 2.5);
    has("two point five kilos", 2.5);
    has("2 point 25 kg", 2.25);
  });
});

describe("checkSpeech", () => {
  it("reads a Finnish November date as November (not the Swedish 'mars')", () => {
    const f = addFacts(emptyFacts(), { say: "60 L of milk, for Friday 20 November.", deliverBy: "2026-11-20" });
    expect(checkSpeech("60 litraa maitoa perjantaiksi 20. marraskuuta. Onko tämä oikein?", f, { final: true })).toEqual([]);
    expect(checkSpeech("60 liter mjölk till fredag den 20 november.", f, { final: true })).toEqual([]);
    expect(checkSpeech("60 litraa maitoa 20. maaliskuuta.", f, { final: true }).map((v) => v.kind)).toContain("date");
  });

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

// ---------- the shared check for written text ----------

import { DATA_DOES_NOT_SAY, addWords, allergenStatementsIn, checkText, claimsIn, factsFrom, groundField, groundText } from "./grounding";

/** A product record as the assistant gets it (server/kitchen-assistant.ts productRecord). */
const oatDrink = {
  id: "product:460110",
  data: {
    code: "460110",
    name: "Oddlygood Barista oat drink 1 l",
    brand: "Oddlygood",
    dietaryClaims: ["lactose_free", "vegan", "milk_free"],
    allergens: { contains: ["oats", "gluten"], mayContain: ["nuts"], statedFreeFrom: ["milk", "eggs", "peanuts", "sesame"] },
    packContent: { L: 1 },
  },
};
const live = { id: "live:460110", data: { priceEurPerSalesUnit: 2.15, earliestDelivery: "2026-11-16", orderBy: "2026-11-15T17:00:00+0200" } };
const mandate = { id: "mandate", data: { forbiddenAllergens: ["nuts", "peanuts"], requiredAttributes: ["lactose_free"], weeklyBudgetEur: 5000 } };
const f = () => factsFrom(oatDrink, live, mandate);
const BR = ["Oddlygood", "Alpro", "Oatly", "Valio"];

describe("checkText: each kind of statement", () => {
  it("product: a brand nobody returned is flagged, one in the data passes, a common-word brand is never judged", () => {
    expect(checkText("Oddlygood Barista is the one.", f(), { brands: BR })).toEqual([]);
    expect(checkText("Try Oatly instead.", f(), { brands: BR })).toEqual([{ kind: "product", said: "Oatly" }]);
    expect(checkText("Fresh oat drink is best.", f(), { brands: [...BR, "Fresh"] })).toEqual([]);
  });
  it("price: a backed price passes, an invented one is flagged", () => {
    expect(checkText("It costs €2.15 a carton.", f())).toEqual([]);
    expect(checkText("It costs €1.95 a carton.", f())).toEqual([{ kind: "price", said: "1.95" }]);
  });
  it("quantity: an amount in the data passes, an invented one is flagged; small bare numbers pass", () => {
    expect(checkText("Each pack holds 1 l.", f())).toEqual([]);
    expect(checkText("Each case holds 12 L.", f())).toEqual([{ kind: "number", said: "12" }]);
    expect(checkText("There are 2 ways to do it, see option 3.", f())).toEqual([]);
  });
  it("date: the delivery day in the data passes, another weekday is flagged", () => {
    expect(checkText("It can arrive on Monday.", f())).toEqual([]);
    expect(checkText("It can arrive on Wednesday.", f())).toEqual([{ kind: "date", said: "wednesday" }]);
  });
  it("claim: a claim the data carries passes, one it does not is flagged, a negated one claims nothing", () => {
    expect(checkText("It is lactose-free and vegan.", f())).toEqual([]);
    expect(checkText("It is gluten-free.", f())).toEqual([{ kind: "claim", said: "gluten-free" }]);
    expect(checkText("It is organic.", f())).toEqual([{ kind: "claim", said: "organic" }]);
    expect(checkText("It is not organic.", f())).toEqual([]);
    expect(checkText("Se on laktoositon.", f())).toEqual([]);
  });
  it("allergen: 'free from' needs a declared free-from; 'contains' needs the allergen listed; a forbidden allergen backs only a rule", () => {
    expect(checkText("It contains no milk and no eggs.", f())).toEqual([]);
    expect(checkText("It contains no nuts.", f()).map((v) => v.kind)).toEqual(["allergen"]);
    expect(checkText("It is nut-free.", f()).map((v) => v.kind)).toContain("claim");
    expect(checkText("It may contain nuts.", f())).toEqual([]);
    expect(checkText("It contains sesame.", f())).toEqual([{ kind: "allergen", said: "contains sesame" }]);
    expect(checkText("Your mandate forbids nuts, so nothing with nuts is offered.", f())).toEqual([]);
  });
  it("a sentence that says the data is silent is never judged for claims", () => {
    expect(checkText("The data does not say whether it is gluten-free.", f())).toEqual([]);
  });
  it("the buyer's own words back their numbers and dates, never a claim", () => {
    const g = addWords(f(), "Is it nut-free? We need 40 L for Friday.");
    expect(checkText("You asked for 40 L for Friday.", g)).toEqual([]);
    expect(checkText("Yes, it is nut-free.", g).length).toBeGreaterThan(0);
  });
});

describe("claimsIn and allergenStatementsIn", () => {
  it("read the three languages and the data's tags", () => {
    expect(claimsIn("lactose_free, gluteeniton, glutenfri").map((c) => c.claim)).toEqual(["lactose_free", "gluten_free", "gluten_free"]);
    expect(allergenStatementsIn("ei sisällä pähkinöitä; innehåller inte ägg").map((a) => [a.allergen, a.polarity])).toEqual([["nuts", "free"], ["eggs", "free"]]);
  });
});

describe("groundText", () => {
  it("replaces only the sentences the data does not back, and collapses repeats", () => {
    const g = groundText("Oddlygood Barista costs €2.15. It is gluten-free. It is organic. It arrives Monday.", f(), { brands: BR });
    expect(g.text).toBe(`Oddlygood Barista costs €2.15. ${DATA_DOES_NOT_SAY} It arrives Monday.`);
    expect(g.replaced).toBe(2);
    expect(g.violations.map((v) => v.kind)).toEqual(["claim", "claim"]);
  });
  it("leaves backed text exactly as it was", () => {
    const text = "Oddlygood Barista costs €2.15 and arrives Monday 16 November.";
    expect(groundText(text, f(), { brands: BR })).toMatchObject({ text, replaced: 0, violations: [] });
  });
  it("groundField replaces a whole short field", () => {
    expect(groundField("Nut-free, so safe for the school", f()).text).toBe(DATA_DOES_NOT_SAY);
    expect(groundField("Barista oat drink for coffee", f()).text).toBe("Barista oat drink for coffee");
  });
});
