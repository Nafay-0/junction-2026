import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, clarify, hardConstraints, violation } from "./clarify";
import { P, kitchen, regularHistory, statedPref } from "./kitchen-fixtures";
import { learnPreferences } from "./kitchen";
import { NeedSchema, type NeedInput } from "./need";
import { sampleMandate } from "./test-fixtures";

const NOW = new Date("2026-11-16T08:00:00Z");
const need = (over: Partial<NeedInput> = {}) => NeedSchema.parse({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, ...over });
const lactoseFree = [P.box, P.box2, P.litre, P.skim, P.whole, P.organic];
const run = (over: Partial<Parameters<typeof clarify>[0]> = {}) => clarify({ need: need(), candidates: lactoseFree, stated: [], learned: [], answers: [], ...over });

describe("hard constraints", () => {
  it("combine the mandate, the request and stated preferences, and name their source", () => {
    const m = sampleMandate(NOW, { requiredAttributes: [], forbiddenAllergens: ["nuts"] });
    const c = hardConstraints(m, need({ requiredClaims: ["organic"], forbiddenAllergens: ["soy"] }), [statedPref({ kind: "require_claim", id: "p1" })]);
    expect(c.requiredAttributes).toEqual(["organic", "lactose_free"]);
    expect(c.forbiddenAllergens).toEqual(["nuts", "soy"]);
    expect(c.sources.map((s) => s.source)).toEqual(["mandate", "mandate", "request", "request", "stated"]);
    expect(violation(P.regular, c)).toBe("not organic, lactose_free");
    expect(violation(P.organic, c)).toBeUndefined();
  });

  it("skip a stated preference the buyer set aside for this request", () => {
    const m = sampleMandate(NOW, { requiredAttributes: [] });
    expect(hardConstraints(m, need(), [statedPref({ kind: "require_claim", id: "p1" })], ["p1"]).requiredAttributes).toEqual([]);
  });

  it("turn remembered dimension answers into rules", () => {
    const m = sampleMandate(NOW, { requiredAttributes: [] });
    const c = hardConstraints(m, need(), [statedPref({ kind: "dimension", id: "p2", dimension: "organic", choice: "none" } as never)]);
    expect(c.excludedAttributes).toEqual(["organic"]);
    expect(violation(P.organic, c)).toBe("is organic");
    expect(violation(P.oat, c)).toBe("contains gluten"); // plant drinks are allowed, gluten is not
    expect(violation({ ...P.box, category: "cream" }, c)).toBe("category cream is not in the mandate");
  });
});

describe("clarification", () => {
  it("asks at most two questions, the most splitting dimension first", () => {
    const c = run();
    expect(c.questions.map((q) => q.id)).toEqual(["dim:fat", "dim:organic"]);
    expect(c.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(c.notAsked).toEqual(["What matters most for this order? Not asked, to keep it short: the options show each kind."]);
  });

  it("gives every question a short fixed list ending in 'no preference'", () => {
    for (const q of run().questions) {
      expect(q.options.length).toBeLessThanOrEqual(5);
      expect(q.options.at(-1)).toEqual({ id: "no_preference", label: "No preference" });
    }
    expect(run().questions[0].options.map((o) => o.label)).toEqual(["Fat-free (0.1 %)", "Semi-skimmed (1.5 %)", "Whole (3.5 %)", "No preference"]);
  });

  it("never asks what the request already says", () => {
    const c = run({ need: need({ item: { text: "milk", category: "milk", attributes: ["fat_1_5"] }, optimise: "price" }) });
    expect(c.questions.map((q) => q.id)).toEqual(["dim:organic"]);
    expect(c.settled.optimise).toBe("price");
  });

  it("does not ask what the kitchen's history answers, and says so (learned: pre-selected)", () => {
    const learned = learnPreferences(kitchen(regularHistory()), "milk");
    const c = run({ learned });
    expect(c.questions.map((q) => q.id)).toEqual(["optimise"]);
    expect(c.questions[0].options.map((o) => o.id)).toEqual(["price", "co2", "reliability", "no_preference"]);
    expect(c.fromMemory.map((m) => [m.question.id, m.optionId, m.source])).toEqual([
      ["dim:fat", "fat_1_5", "learned"],
      ["dim:organic", "none", "learned"],
    ]);
    expect(c.fromMemory[0].text).toMatch(/^Pre-selected from history: Semi-skimmed \(1.5 %\): 10 of your last 10 milk orders$/);
    expect(c.settled).toMatchObject({ attributes: ["fat_1_5"], excludedAttributes: ["organic"] });
  });

  it("uses a stated optimisation preference with its tolerance, and says who set it", () => {
    const so = statedPref({ kind: "optimise", id: "p3", goal: "co2", withinPctOfCheapest: 5, text: "Prefer lowest CO2 if within 5 % of the cheapest" } as never);
    const c = run({ need: need({ item: { text: "milk", category: "milk", attributes: ["fat_1_5"] } }), candidates: [P.box, P.box2, P.litre], stated: [so] });
    expect(c.questions).toEqual([]);
    expect(c.settled).toMatchObject({ optimise: "co2", optimiseWithinPctOfCheapest: 5, optimiseSource: "stated" });
    expect(c.fromMemory[0]).toMatchObject({ source: "stated", preferenceId: "p3", text: "Prefer lowest CO2 if within 5 % of the cheapest (set by Aino Virtanen)" });
  });

  it("an answer beats memory, and 'no preference' settles without narrowing", () => {
    const learned = learnPreferences(kitchen(regularHistory()), "milk");
    const c = run({ learned, answers: [{ questionId: "dim:fat", optionId: "no_preference" }, { questionId: "optimise", optionId: "no_preference" }] });
    expect(c.questions).toEqual([]);
    expect(c.settled.attributes).toEqual([]);
    expect(c.settled.optimise).toBe("no_preference");
    expect(c.fromMemory.map((m) => m.question.id)).toEqual(["dim:organic"]);
  });

  it("does not ask about a dimension the remaining products agree on", () => {
    const c = run({ candidates: [P.box, P.box2, P.litre], need: need({ optimise: "no_preference" }) });
    expect(c.questions).toEqual([]);
  });

  it("asks nothing when nothing is left to choose from", () => {
    expect(run({ candidates: [] }).questions).toEqual([]);
  });
});
