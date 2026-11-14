import { describe, expect, it } from "vitest";
import { joinDayFragment as join } from "./refusal";


describe("a day said as its own fragment joins the sentence after it", () => {
  it("joins 'For Friday 20 Nov. I can get' into one sentence", () => {
    expect(join("For {{Friday 20 Nov}}. I can get **20 l** in cartons.")).toBe("For {{Friday 20 Nov}}, I can get **20 l** in cartons.");
    expect(join("Your usual box can't come. For Friday 20 Nov. The Valio Eila is 20,20 €.")).toBe("Your usual box can't come. For Friday 20 Nov, the Valio Eila is 20,20 €.");
    expect(join("For {{Friday 20 Nov}}. Valio Eila is 20,20 €.")).toBe("For {{Friday 20 Nov}}, Valio Eila is 20,20 €.");
  });
});
