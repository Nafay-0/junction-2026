import { describe, expect, it } from "vitest";
import { NeedSchema } from "@/core/need";
import { amountInWords, digitsIn, numberInWords, readBackReason, yesOrNo } from "./speech";

const need = (amount: number, unit: "L" | "kg" | "pcs" | "pack", text = "milk", category?: string) => NeedSchema.parse({ item: { text, ...(category ? { category } : {}) }, quantity: { amount, unit } });

describe("numberInWords", () => {
  it("spells amounts for a read-back", () => {
    expect(numberInWords(1000)).toBe("one thousand");
    expect(numberInWords(15)).toBe("fifteen");
    expect(numberInWords(250)).toBe("two hundred and fifty");
    expect(numberInWords(2.5)).toBe("two point five");
    expect(amountInWords(1, "L")).toBe("one litre");
    expect(amountInWords(40, "kg")).toBe("forty kilos");
  });
});

describe("readBackReason", () => {
  const usual = [{ family: "milk", amount: 100, unit: "L" }];
  it("reads back an amount far from what this kitchen usually orders, and says why", () => {
    expect(readBackReason(need(400, "L", "milk", "milk"), { usual })).toBe("this kitchen usually orders about 100 L of milk");
    expect(readBackReason(need(30, "L", "milk", "milk"), { usual })).toMatch(/much more than this/);
  });
  it("lets an ordinary amount through without asking", () => {
    expect(readBackReason(need(120, "L", "milk", "milk"), { usual })).toBeUndefined();
    expect(readBackReason(need(20, "kg", "butter"), { usual })).toBeUndefined();
  });
  it("reads back large amounts, packs, first large orders and transcripts that disagree", () => {
    expect(readBackReason(need(1000, "L"), { usual })).toMatch(/large amount/);
    expect(readBackReason(need(6, "pack"), { usual })).toMatch(/pack size/);
    expect(readBackReason(need(300, "kg", "butter"), { usual: [] })).toMatch(/no earlier order/);
    expect(readBackReason(need(50, "L"), { usual: [], heardNumbers: [15], spokenNumbers: [50] })).toMatch(/heard 15/);
  });
});

describe("digitsIn and yesOrNo", () => {
  it("reads numbers the way transcripts write them", () => {
    expect(digitsIn("I need 1,000 L and 2,5 kg and 1 000 litres")).toEqual([1000, 2.5, 1000]);
  });
  it("tells a yes from a no in three languages, and calls a mixed answer unclear", () => {
    for (const y of ["Yes, that's right", "kyllä", "joo, oikein", "ja, det stämmer", "okay place it"]) expect(yesOrNo(y)).toBe("yes");
    for (const n of ["No, fifteen", "ei", "nej, fel", "wait"]) expect(yesOrNo(n)).toBe("no");
    expect(yesOrNo("yes no")).toBe("unclear");
    expect(yesOrNo("fifteen litres")).toBe("unclear");
  });
});
