import { describe, expect, it } from "vitest";
import { scenarioAnswerOf, scenarioOf, type PendingScenario } from "./thread";

describe("the conversation's side of the menu scenarios", () => {
  it("tells which scenario the words ask for, in English, Finnish and Swedish", () => {
    expect(scenarioOf("Plan a menu around what is in season, 40 covers on Friday")).toBe("seasonal");
    expect(scenarioOf("Jotain juureksista perjantaiksi, 40 annosta")).toBe("seasonal");
    expect(scenarioOf("Unexpected booking for 40 tomorrow, three courses")).toBe("event");
    expect(scenarioOf("Yllättävä 40 hengen varaus huomiseksi, kolme ruokalajia")).toBe("event");
    expect(scenarioOf("En oväntad bokning för 40 i morgon")).toBe("event");
    // A booking for tomorrow around chanterelles is about the day first.
    expect(scenarioOf("A booking tomorrow for 30, something with chanterelles")).toBe("event");
    expect(scenarioOf("100 litres of milk for Monday")).toBeUndefined();
  });

  const pending: PendingScenario = {
    kind: "event",
    planId: "plan_1",
    words: "booking",
    options: [
      { optionId: "cf:smetana", lineId: "cf", words: ["smetana", "tunturi"] },
      { optionId: "cf:cream_lemon", lineId: "cf", words: ["cooking", "cream", "lemon", "sitruunamehu", "ruokakerma"] },
    ],
  };

  it("turns the buyer's words into a decision: a product by name, the first or the second, yes or no", () => {
    expect(scenarioAnswerOf("use the smetana", pending)).toEqual({ kind: "choose", optionId: "cf:smetana" });
    expect(scenarioAnswerOf("ruokakerma ja sitruuna käy", pending)).toEqual({ kind: "choose", optionId: "cf:cream_lemon" });
    expect(scenarioAnswerOf("the second one", pending)).toEqual({ kind: "choose", optionId: "cf:cream_lemon" });
    expect(scenarioAnswerOf("ensimmäinen", pending)).toEqual({ kind: "choose", optionId: "cf:smetana" });
    expect(scenarioAnswerOf("yes, do that", pending)).toEqual({ kind: "yes" });
    expect(scenarioAnswerOf("no thanks", pending)).toEqual({ kind: "no" });
    expect(scenarioAnswerOf("what is the weather like", pending)).toBeUndefined();
    // "Monday is fine" to "plan it for Monday instead?" is a yes; "use that instead" is a yes to the best swap.
    expect(scenarioAnswerOf("Monday is fine", { ...pending, options: [], earliest: "2026-11-16" })).toEqual({ kind: "day", date: "2026-11-16" });
    expect(scenarioAnswerOf("maanantai sopii", { ...pending, options: [], earliest: "2026-11-16" })).toEqual({ kind: "day", date: "2026-11-16" });
    expect(scenarioAnswerOf("use that instead", pending)).toEqual({ kind: "yes" });
    // Any verified option of any line, named: "add the frozen beef cheek".
    expect(scenarioAnswerOf("add the frozen beef cheek", { ...pending, more: [{ optionId: "bc:same_frozen", lineId: "bc", words: ["frozen", "cheek", "haudutettu"] }] })).toEqual({ kind: "choose", optionId: "bc:same_frozen" });
    // A day nothing could make: a yes plans it for the earliest day.
    expect(scenarioAnswerOf("joo", { ...pending, options: [], earliest: "2026-11-16" })).toEqual({ kind: "day", date: "2026-11-16" });
  });
});
