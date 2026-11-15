import { describe, expect, it } from "vitest";
import { THREAD_LINE_TEXT } from "@/app/k/[kitchen]/thread-line.text";
import { spokenProduct } from "./home";

describe("the opening's order times", () => {
  it("name each product as people say it, never the raw catalogue name", () => {
    expect(spokenProduct("Salakis Turkish Yoghurt Natural 1kg")).toBe("Salakis Turkish yoghurt natural");
    expect(spokenProduct("LOLLOROSSO FI")).toBe("lollorosso");
    expect(spokenProduct("Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free")).not.toMatch(/®|\d/);
  });
  it("say several closing at the same time in one sentence", () => {
    expect(THREAD_LINE_TEXT.en.today.cutoffs(["Salakis Turkish yoghurt natural", "lollorosso"], "17.00")).toBe("Order by {{17.00}} today for the Salakis Turkish yoghurt natural and the lollorosso.");
    expect(THREAD_LINE_TEXT.en.today.cutoffs(["a", "b", "c"], "15.00")).toBe("Order by {{15.00}} today for the a, the b and the c.");
    expect(THREAD_LINE_TEXT.fi.today.cutoffs(["a", "b"], "17.00")).toBe("Tilaa a ja b tänään {{17.00}} mennessä.");
    expect(THREAD_LINE_TEXT.sv.today.cutoffs(["a"], "17.00")).toBe("Beställ a senast {{17.00}} i dag.");
  });
});
