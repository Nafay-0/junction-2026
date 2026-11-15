import { describe, expect, it } from "vitest";
import { joinDayFragment as join } from "./refusal";


describe("a day said as its own fragment joins the sentence after it", () => {
  it("joins 'For Friday 20 Nov. I can get' into one sentence", () => {
    expect(join("For {{Friday 20 Nov}}. I can get **20 l** in cartons.")).toBe("For {{Friday 20 Nov}}, I can get **20 l** in cartons.");
    expect(join("Your usual box can't come. For Friday 20 Nov. The Valio Eila is 20,20 €.")).toBe("Your usual box can't come. For Friday 20 Nov, the Valio Eila is 20,20 €.");
    expect(join("For {{Friday 20 Nov}}. Valio Eila is 20,20 €.")).toBe("For {{Friday 20 Nov}}, Valio Eila is 20,20 €.");
  });
});

describe("a clause cut at its connective and a day", () => {
  it("ends where the whole clause ends", async () => {
    const { dropDanglingDay } = await import("./refusal");
    expect(dropDanglingDay("Your usual 20 l whipping cream missed its cut-off, so for {{Monday 16 Nov}}. Shall I?")).toBe("Your usual 20 l whipping cream missed its cut-off. Shall I?");
    expect(dropDanglingDay("It missed the cut-off, so for Monday 16 Nov.")).toBe("It missed the cut-off.");
    expect(dropDanglingDay("It comes on Monday, so you have it for lunch.")).toBe("It comes on Monday, so you have it for lunch.");
  });
});

describe("the reply's closing question", () => {
  it("is its whole last sentence, never cut inside a day", async () => {
    const { CLOSING_ASK } = await import("./engine");
    const one = "Your usual 10 l boxes missed their cut-off for {{Monday 16 Nov}}, shall I order the Valio Eila or another?";
    expect(one.replace(CLOSING_ASK, "").trim()).toBe("");
    expect(CLOSING_ASK.exec("It costs **10,00 €**. Shall I order it?")?.[0].trim()).toBe("Shall I order it?");
  });
});
