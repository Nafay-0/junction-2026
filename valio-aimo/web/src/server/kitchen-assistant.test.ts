import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_WORDS, ask } from "./kitchen-assistant";
import { resolveKitchen } from "./console-kitchens";
import { resetRuntime } from "./runtime";

describe("questions only a live lookup can answer", () => {
  it.each([
    "Can it arrive tomorrow?",
    "When can this be here?",
    "Will it make it by Monday?",
    "What does it cost?",
    "Ehtiikö tämä huomiseksi?",
    "Milloin se tulee perille?",
    "Saako tämän maanantaina?",
    "Kan den levereras imorgon?",
    "När kommer den fram?",
    "Hur mycket kostar den?",
  ])("%s", (q) => expect(LIVE_WORDS.test(q)).toBe(true));

  it.each(["Is this lactose-free?", "Which allergens does it contain?", "Onko tämä gluteeniton?", "Update my notes"])("not: %s", (q) => expect(LIVE_WORDS.test(q)).toBe(false));
});

describe("the assistant looks up the product on screen for a delivery question (QA F-ASSIST-ARRIVE-NO-LIVE)", () => {
  beforeEach(() => {
    resetRuntime();
    vi.stubEnv("DOCK_CATALOG", "seed");
    vi.stubEnv("DOCK_LLM", "off"); // no model: the answer falls back to the records, and still says what was looked up
  });

  it("'Can it arrive tomorrow?' about the product on screen makes one live lookup and hands its date over", async () => {
    const k = await resolveKitchen("kaari");
    const r = await ask(k!, { question: "Can it arrive tomorrow?", productId: "VA-2301", screen: "the product page of product VA-2301" });
    expect(r.liveCalls).toBe(1);
    expect(r.citations.some((c) => c.id === "live:VA-2301")).toBe(true);
  });
});
