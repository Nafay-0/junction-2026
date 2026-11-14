import { describe, expect, it } from "vitest";
import { applyNeedPatch, NeedSchema } from "./need";
import { claimNegatedInWords, compareReadings, describeSecondReading, fieldValues, numbersInText, readerName, readingConcerns, READING_RULES, type Reading, type SecondReadingRecord } from "./second-reading";

const base: Reading = {
  item: { text: "lactose-free milk", attributes: ["lactose_free"], excludedAttributes: [] },
  quantity: { amount: 1000, unit: "L" },
  deliverBy: "2026-11-16",
  requiredClaims: [],
  forbiddenAllergens: [],
  sameAsLastTime: false,
};
const r = (over: Omit<Partial<Reading>, "item"> & { item?: Partial<Reading["item"]> } = {}): Reading => ({ ...base, ...over, item: { ...base.item, ...over.item } });
const fields = (first: Reading, second: Reading, text = "") => compareReadings(first, second, { text }).differences.map((d) => d.field);

describe("compareReadings: agreement", () => {
  it("the same reading agrees", () => {
    expect(compareReadings(base, r())).toMatchObject({ agreed: true, differences: [] });
  });

  it("equivalent forms agree: 1000 l and 1 000 litres are both 1000 L; pcs and packs both count packs", () => {
    expect(compareReadings(r({ quantity: { amount: 1000, unit: "L" } }), r({ quantity: { amount: 1000, unit: "L" } }), { text: "1 000 litres" }).agreed).toBe(true);
    expect(compareReadings(r({ quantity: { amount: 30, unit: "pack" } }), r({ quantity: { amount: 30, unit: "pcs" } })).agreed).toBe(true);
  });

  it("100 x 10 l agrees as 100 packs or 1,000 L, because the pack size is written in the text", () => {
    const text = "100 x 10 l laktoositonta maitoa";
    expect(compareReadings(r({ quantity: { amount: 100, unit: "pack" } }), r({ quantity: { amount: 1000, unit: "L" } }), { text }).agreed).toBe(true);
    expect(compareReadings(r({ quantity: { amount: 1000, unit: "L" } }), r({ quantity: { amount: 100, unit: "pack" } }), { text }).agreed).toBe(true);
  });

  it("claim spellings and the catalogue's words agree: lactose-free, LACTOSE_FREE, laktoositon", () => {
    expect(compareReadings(base, r({ item: { attributes: ["laktoositon"] } })).agreed).toBe(true);
    expect(compareReadings(base, r({ item: { attributes: [] }, requiredClaims: ["LACTOSE_FREE"] })).agreed).toBe(true);
  });

  it("gluten-free as a claim and gluten as an allergen to avoid agree", () => {
    expect(compareReadings(r({ requiredClaims: ["gluten_free"] }), r({ forbiddenAllergens: ["gluten"] })).agreed).toBe(true);
    expect(compareReadings(r({ forbiddenAllergens: ["nut"] }), r({ forbiddenAllergens: ["nuts"] })).agreed).toBe(true);
  });

  it("the item in other words of the same kind agrees: maitoa and laktoositonta maitoa, maito and maitoa", () => {
    expect(compareReadings(r({ item: { text: "maitoa" } }), r({ item: { text: "laktoositonta maitoa" } })).agreed).toBe(true);
    expect(compareReadings(r({ item: { text: "maito" } }), r({ item: { text: "maitoa" } })).agreed).toBe(true);
    expect(compareReadings(r({ item: { text: "kermaa" } }), r({ item: { text: "ruokakermaa" } })).agreed).toBe(true);
  });

  it("small amount differences are not material, and 'by' against 'on' the same day is not", () => {
    const c = compareReadings(r({ quantity: { amount: 100, unit: "L" } }), r({ quantity: { amount: 150, unit: "L" }, deliverOn: "2026-11-16" }));
    expect(c.agreed).toBe(true);
    expect(c.minor.length).toBeGreaterThan(0);
  });

  it("a second reading that read less finds nothing to compare: no amount, no date, are minor", () => {
    const c = compareReadings(base, r({ quantity: undefined, deliverBy: undefined }));
    expect(c.agreed).toBe(true);
    expect(c.minor).toEqual(expect.arrayContaining([expect.stringContaining("no amount"), expect.stringContaining("no delivery day")]));
  });

  it("marketing attributes and a fat content only one reading states are not material", () => {
    expect(compareReadings(base, r({ item: { attributes: ["lactose_free", "low_salt", "fat_1_5"] } })).agreed).toBe(true);
  });
});

describe("compareReadings: material differences", () => {
  it("the amount by a large factor: 1.000 read as 1 and as 1000", () => {
    const c = compareReadings(r({ quantity: { amount: 1, unit: "L" } }), r({ quantity: { amount: 1000, unit: "L" } }));
    expect(c.differences).toMatchObject([{ field: "amount", first: "1 L", second: "1,000 L", patch: { quantity: { amount: 1000, unit: "L" } } }]);
  });

  it("10x is named, and the threshold is READING_RULES.amountFactor", () => {
    expect(compareReadings(r({ quantity: { amount: 100, unit: "L" } }), base).differences[0].why).toBe("10x the amount");
    const f = READING_RULES.amountFactor;
    expect(fields(r({ quantity: { amount: 100, unit: "L" } }), r({ quantity: { amount: 100 * f, unit: "L" } }))).toEqual(["amount"]);
    expect(fields(r({ quantity: { amount: 100, unit: "L" } }), r({ quantity: { amount: 100 * f * 0.99, unit: "L" } }))).toEqual([]);
    expect(f).toBe(2);
  });

  it("the unit: packs against litres with no pack size in the text", () => {
    const c = compareReadings(r({ quantity: { amount: 20, unit: "pack" } }), r({ quantity: { amount: 20, unit: "L" } }), { text: "20 laatikkoa maitoa" });
    expect(c.differences).toMatchObject([{ field: "amount", why: "packs against L" }]);
  });

  it("litres against kilos with a different amount; the same amount is minor", () => {
    expect(fields(r({ quantity: { amount: 10, unit: "kg" } }), r({ quantity: { amount: 100, unit: "L" } }))).toEqual(["amount"]);
    expect(fields(r({ quantity: { amount: 10, unit: "kg" } }), r({ quantity: { amount: 10, unit: "L" } }))).toEqual([]);
  });

  it("only the second reading has an amount (the first read 'same as last time')", () => {
    expect(fields(r({ quantity: undefined, sameAsLastTime: true }), r({ quantity: { amount: 200, unit: "L" } }))).toEqual(["amount"]);
  });

  it("a dietary claim the second reading requires and the first does not; the other way round only when asked for", () => {
    expect(compareReadings(r({ item: { attributes: [] } }), base).differences).toMatchObject([{ field: "claims", first: "not stated", second: "lactose-free" }]);
    expect(compareReadings(base, r({ item: { attributes: [] } })).agreed).toBe(true);
    expect(compareReadings(base, r({ item: { attributes: [] } }), { rules: { askWhenOnlyFirstHasClaim: true } }).differences).toMatchObject([{ field: "claims", first: "lactose-free", second: "not stated" }]);
  });

  it("one reading excludes a claim and the other is silent: neither requires it, so no question", () => {
    expect(compareReadings(r({ item: { attributes: [] } }), r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } })).agreed).toBe(true);
  });

  it("a negated claim: 'not lactose-free' read as lactose-free", () => {
    const c = compareReadings(r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } }), base);
    expect(c.differences).toMatchObject([{ field: "claims", first: "not lactose-free", second: "lactose-free", why: "lactose-free negated in one reading" }]);
  });

  it("two different fat contents, when fat is compared (it is not by default: not a dietary or allergen claim)", () => {
    expect(fields(r({ item: { attributes: ["fat_1_5"] } }), r({ item: { attributes: ["fat_3_5"] } }))).toEqual([]);
    expect(compareReadings(r({ item: { attributes: ["fat_1_5"] } }), r({ item: { attributes: ["fat_3_5"] } }), { rules: { compareFat: true } }).differences[0].field).toBe("claims");
  });

  it("an allergen to avoid that only the second reading has (mentioned as a thing to avoid)", () => {
    const c = compareReadings(r(), r({ forbiddenAllergens: ["nuts"] }), { text: "We have a nut allergy: 20 kg of vanilla yoghurt without nuts" });
    expect(c.differences).toMatchObject([{ field: "allergens", first: "not stated", second: "no nuts", patch: { forbiddenAllergens: ["nuts"] } }]);
    expect(compareReadings(r({ forbiddenAllergens: ["nuts"] }), r()).agreed).toBe(true);
  });

  it("a different kind of product: cream for milk, coffee milk for milk, two product codes", () => {
    expect(fields(r({ item: { text: "maitoa" } }), r({ item: { text: "kermaa" } }))).toEqual(["kind"]);
    expect(fields(r({ item: { text: "milk" } }), r({ item: { text: "coffee milk" } }))).toEqual(["kind"]);
    expect(fields(r({ item: { productId: "6408430000123" } }), r({ item: { productId: "6408430000999" } }))).toEqual(["kind"]);
  });

  it("the delivery day: two different days, and a day only the second reading has", () => {
    expect(compareReadings(base, r({ deliverBy: "2026-11-23" })).differences).toMatchObject([{ field: "date", first: "Mon 16.11.2026", second: "Mon 23.11.2026", patch: { deliverBy: "2026-11-23" } }]);
    expect(fields(r({ deliverBy: undefined }), base)).toEqual(["date"]);
  });

  it("the rules can be relaxed field by field", () => {
    expect(compareReadings(r({ deliverBy: undefined }), base, { rules: { askWhenOnlySecondHasDate: false } }).agreed).toBe(true);
    expect(compareReadings(base, r({ deliverBy: undefined }), { rules: { askWhenOnlyFirstHasDate: true } }).differences[0].field).toBe("date");
    expect(compareReadings(r({ item: { attributes: [] } }), base, { rules: { askWhenOnlySecondHasClaim: false } }).agreed).toBe(true);
    expect(compareReadings(r({ item: { text: "maitoa" } }), r({ item: { text: "kermaa" } }), { rules: { compareKind: false } }).agreed).toBe(true);
  });
});

describe("only what the words say", () => {
  it("a claim or allergen the words do not name is no question: the reading that has it invented it", () => {
    const text = "200 L milk for Thursday";
    expect(compareReadings(r({ item: { attributes: [] } }), r({ item: { attributes: ["lactose_free"], excludedAttributes: ["organic", "vegan"] } }), { text }).agreed).toBe(true);
    expect(compareReadings(r({ item: { attributes: [] } }), r({ item: { attributes: [] }, forbiddenAllergens: ["milk"] }), { text }).agreed).toBe(true);
  });

  it("a claim the words name is compared in either polarity: 'not lactose-free' read as lactose-free", () => {
    const text = "Ordinary milk, not lactose-free, 150 litres for Thursday";
    expect(fields(r({ item: { attributes: ["lactose_free"] } }), r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } }), text)).toEqual(["claims"]);
  });

  it("nuts and peanuts are told apart in all three languages", () => {
    const sv = "Allergi i köket: inga jordnötter. 15 kg kvarg till måndag";
    expect(compareReadings(r({ forbiddenAllergens: ["peanuts"] }), r({ forbiddenAllergens: ["peanuts", "nuts"] }), { text: sv }).agreed).toBe(true);
    const fi = "Ei pähkinöitä eikä maapähkinöitä: 15 kg rahkaa";
    expect(fields(r({ forbiddenAllergens: ["peanuts"] }), r({ forbiddenAllergens: ["peanuts", "nuts"] }), fi)).toEqual(["allergens"]);
  });

  it("no day in the words: a day in one reading is no question", () => {
    expect(compareReadings(r({ deliverBy: undefined }), r({ deliverBy: "2026-11-15" }), { text: "300 liter mjölk, ingen brådska" }).agreed).toBe(true);
  });

  it("the words name Friday: a second reading on a Monday misread it, no question; a first reading on a Monday is asked", () => {
    const text = "a dozen cases of butter for Friday";
    expect(compareReadings(r({ deliverBy: "2026-11-20" }), r({ deliverBy: "2026-11-16" }), { text }).agreed).toBe(true);
    expect(fields(r({ deliverBy: "2026-11-16" }), r({ deliverBy: "2026-11-20" }), text)).toEqual(["date"]);
    // "next Tuesday": both readings are Tuesdays, a week apart, and that is asked.
    expect(fields(r({ deliverBy: "2026-11-17" }), r({ deliverBy: "2026-11-24" }), "50 litres of milk for next Tuesday")).toEqual(["date"]);
    // A Monday a year ahead (a written "1.11." read from nowhere) does not fit "for Monday" either.
    expect(compareReadings(r({ deliverBy: "2026-11-16" }), r({ deliverBy: "2027-11-01" }), { text: "100 kg yoghurt for Monday", today: "2026-11-14" }).agreed).toBe(true);
  });
});

describe("negation and totals in the words", () => {
  it("a second reading that excludes a claim the words do not negate misread it: no question", () => {
    const text = "Need yoghurt, 2 dozen 1 kg tubs, lactose free, no nuts, Tuesday";
    expect(compareReadings(base, r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } }), { text }).agreed).toBe(true);
  });

  it("the words negate it, in each language: asked", () => {
    for (const text of ["Ordinary milk, not lactose-free, 150 litres", "Tavallista maitoa, ei laktoositonta, 150 litraa", "Vanlig mjölk, inte laktosfri, 150 liter", "Lactose-free is not needed: 120 litres of milk", "lactose-free isn't needed this time"]) {
      expect(claimNegatedInWords(text, "lactose_free")).toBe(true);
      expect(fields(base, r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } }), text)).toEqual(["claims"]);
    }
    expect(claimNegatedInWords("lactose free, no nuts", "lactose_free")).toBe(false);
  });

  it("the second reading writing the total as packs ('100 x 10 l' as 1,000 packs of 10 l) is no question; the first doing it is", () => {
    const text = "100 x 10 l bag-in-box milk for Wednesday";
    const packs = (n: number, size?: number) => r({ quantity: { amount: n, unit: "pack" }, ...(size ? { packSize: { amount: size, unit: "L" as const } } : {}) });
    expect(compareReadings(packs(100), packs(1000, 10), { text }).agreed).toBe(true);
    expect(fields(packs(1000), packs(100, 10), text)).toEqual(["amount"]);
  });
});

describe("numbersInText", () => {
  it("reads digit grouping both ways", () => {
    expect(numbersInText("1.000 litraa")).toEqual(expect.arrayContaining([1000, 1]));
    expect(numbersInText("1,000 litres")).toEqual(expect.arrayContaining([1000, 1]));
    expect(numbersInText("1 000 l")).toEqual(expect.arrayContaining([1000]));
    expect(numbersInText("100 x 10 l")).toEqual(expect.arrayContaining([100, 10]));
    expect(numbersInText("2,5 kg")).toEqual(expect.arrayContaining([2.5]));
  });
});

describe("readingConcerns", () => {
  const record = (first: Reading, second: Reading): SecondReadingRecord => {
    const c = compareReadings(first, second);
    return { status: c.agreed ? "agreed" : "differed", firstModel: "anthropic:claude-opus-5-5", secondModel: "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16", differences: c.differences, minor: c.minor, firstValues: fieldValues(first), at: "2026-11-14T10:00:00Z" };
  };
  const need = NeedSchema.parse({ text: "I need 1,000 litres of lactose-free milk by Monday", ...base });

  it("one precise question per differing field, showing both readings, with no default and a way out", () => {
    const rec = record(base, r({ quantity: { amount: 100, unit: "L" } }));
    const [c] = readingConcerns(need, rec);
    expect(c).toMatchObject({ code: "readings_differ", severity: "warning", confirmable: false });
    expect(c.message).toBe("Two independent readers read the amount differently: Claude Opus 5.5 read 1,000 L, NVIDIA Nemotron 3 Nano read 100 L. Which did you mean?");
    expect(c.corrections.map((x) => [x.id, x.label])).toEqual([
      ["keep_first", "1,000 L"],
      ["use_second", "100 L"],
      ["rewrite", "Neither: I will write it again"],
    ]);
    expect(applyNeedPatch(need, c.corrections[1].patch!).quantity).toEqual({ amount: 100, unit: "L" });
    expect(applyNeedPatch(need, c.corrections[0].patch!)).toEqual(need);
  });

  it("no question when the readings agree, when the reader was unavailable, or once the field was changed", () => {
    expect(readingConcerns(need, record(base, r()))).toEqual([]);
    expect(readingConcerns(need, { ...record(base, r({ quantity: { amount: 100, unit: "L" } })), status: "unavailable" })).toEqual([]);
    expect(readingConcerns(need, undefined)).toEqual([]);
    const changed = applyNeedPatch(need, { quantity: { amount: 500, unit: "L" } });
    expect(readingConcerns(changed, record(base, r({ quantity: { amount: 100, unit: "L" } })))).toEqual([]);
  });

  it("taking the second reading's claims or allergens rewrites only those", () => {
    const negated = record(base, r({ item: { attributes: [], excludedAttributes: ["lactose_free"] } }));
    const [c] = readingConcerns(need, negated);
    const after = applyNeedPatch(need, c.corrections.find((x) => x.id === "use_second")!.patch!);
    expect(after.item).toMatchObject({ attributes: [], excludedAttributes: ["lactose_free"] });
    const nuts = record(base, r({ forbiddenAllergens: ["nuts"] }));
    const [a] = readingConcerns(need, nuts);
    expect(applyNeedPatch(need, a.corrections.find((x) => x.id === "use_second")!.patch!).forbiddenAllergens).toEqual(["nuts"]);
  });

  it("the ledger line names both readers and what happened", () => {
    expect(describeSecondReading(record(base, r()))).toMatch(/^Read twice, by Claude Opus 5.5 and NVIDIA Nemotron 3 Nano: the two readings agree/);
    expect(describeSecondReading({ ...record(base, r()), status: "unavailable", reason: "timeout" })).toMatch(/unavailable \(timeout\)\. Dock carried on with the first reading\./);
  });

  it("names readers in words", () => {
    expect(readerName("anthropic:claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(readerName("featherless:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16")).toBe("NVIDIA Nemotron 3 Super");
  });
});
