import { describe, expect, it } from "vitest";
import { KnowledgeMap } from "@/server/knowledge/map";
import { testKnowledge, testProducts } from "@/server/knowledge/test-catalogue";
import { SmartSearch } from "./finder";
import { ScriptedJudge, type JudgeInput, type JudgeOutput, type RelevanceJudge } from "./judge";
import { SearchIndex, editDistance } from "./recall";
import { ProductVectors, encodeVectors, parseVectorsBytes, quantise } from "./vectors";

// Synthetic catalogue and map (knowledge/test-catalogue.ts): no partner text, no model call. The judge is scripted.
const products = testProducts();
const map = new KnowledgeMap(products, testKnowledge());
const index = new SearchIndex(products, map, null);

/** Labels by product-name words, the way a test can state what a real judge would say. */
const byWords = (rules: [RegExp, "exact" | "variant" | "standin" | "other"][]) => new ScriptedJudge((_t, line) => rules.find(([re]) => re.test(line))?.[1] ?? "other");

describe("smart search: the hard rules come first and are never dropped", () => {
  it("reads a misspelt claim word as the claim (stricter, never looser) and says so", async () => {
    const s = new SmartSearch({ index, config: { judge: false } });
    const r = await s.find({ text: "laktositon kerma" });
    expect(r.applied.claims).toContain("lactose_free");
    expect(r.notes.join(" ")).toMatch(/laktositon.*lactose-free/);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.product.attributes.includes("lactose_free"))).toBe(true);
  });

  it("keeps the request's claims even when the words do not say them", async () => {
    const s = new SmartSearch({ index, config: { judge: false } });
    const r = await s.find({ text: "milk", requiredClaims: ["lactose_free"] });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.product.attributes.includes("lactose_free"))).toBe(true);
  });

  it("reads 'without X' as a forbidden allergen; unknown allergen data is not safe", () => {
    const u = index.understand("a plant drink without soy for a child");
    expect(u.forbiddenAllergens).toContain("soy");
    expect(u.terms).not.toContain("soy");
    const fi = index.understand("pähkinätön jälkiruoka");
    expect(fi.forbiddenAllergens).toContain("nuts");
    const sv = index.understand("efterrätt utan nötter");
    expect(sv.forbiddenAllergens).toContain("nuts");
    // A gluten-free claim stays a claim: no extra allergen rule that would drop products without allergen data.
    expect(index.understand("gluten free bread").forbiddenAllergens).not.toContain("gluten");
  });

  it("a judge can never bring back a product the hard rules removed", async () => {
    const s = new SmartSearch({ index, judge: new ScriptedJudge(() => "exact") });
    const r = await s.find({ text: "whipping cream", requiredClaims: ["lactose_free"] });
    expect(r.hits.map((h) => h.product.id)).not.toContain("800004"); // the one without lactose-free
  });
});

describe("smart search: the judge orders, labels and can say 'we do not sell that'", () => {
  it("puts what was asked first and labels stand-ins as stand-ins", async () => {
    const judge = byWords([
      [/oat whipping/i, "standin"],
      [/whipping cream/i, "exact"],
    ]);
    const s = new SmartSearch({ index, judge });
    const r = await s.find({ text: "whipping cream" });
    expect(r.path).toBe("judge");
    expect(r.hits[0].label).toBe("exact");
    const labels = r.hits.map((h) => h.label);
    expect(labels.indexOf("standin")).toBeGreaterThan(labels.lastIndexOf("exact"));
    expect(r.hits.some((h) => h.label === "other")).toBe(false);
  });

  it("only stand-ins: says so, so the thread can say 'instead'", async () => {
    const s = new SmartSearch({ index, judge: byWords([[/oat whipping/i, "standin"]]) });
    const r = await s.find({ text: "almond whipping cream" });
    expect(r.onlyStandins).toBe(true);
    expect(r.hits.every((h) => h.label === "standin")).toBe(true);
  });

  it("nothing of the kind: an empty answer, marked not sold", async () => {
    const s = new SmartSearch({ index, judge: new ScriptedJudge(() => "other") });
    const r = await s.find({ text: "kangaroo cream" });
    expect(r.notSold).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("a late judge leaves the fused ranking, and the result says which path answered", async () => {
    const slow: RelevanceJudge = {
      name: "slow",
      judge: (_i: JudgeInput, timeoutMs: number) => new Promise<JudgeOutput>((_res, rej) => setTimeout(() => rej(new Error(`late (no answer within ${timeoutMs} ms)`)), timeoutMs)),
    };
    const calls: string[] = [];
    const s = new SmartSearch({ index, judge: slow, config: { judgeTimeoutMs: 30 }, observe: (c) => calls.push(`${c.kind}:${c.ok}`) });
    const r = await s.find({ text: "whipping cream" });
    expect(r.path).toBe("ranked");
    expect(r.reason).toMatch(/judge late/);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(calls).toEqual(["judge:false"]);
  });

  it("over today's cap: no judge call at all", async () => {
    let asked = 0;
    const judge: RelevanceJudge = { name: "count", judge: async (i) => ((asked++), new ScriptedJudge().judge(i)) };
    const s = new SmartSearch({ index, judge, admit: () => false });
    const r = await s.find({ text: "whipping cream" });
    expect(asked).toBe(0);
    expect(r.reason).toMatch(/cap/);
  });

  it("a product code said outright is a lookup: first, exact, no judge", async () => {
    let asked = 0;
    const judge: RelevanceJudge = { name: "count", judge: async (i) => ((asked++), new ScriptedJudge().judge(i)) };
    const s = new SmartSearch({ index, judge });
    const r = await s.find({ text: "product 800003" });
    expect(r.hits[0].product.id).toBe("800003");
    expect(r.hits[0].label).toBe("exact");
    expect(asked).toBe(0);
  });

  it("is deterministic for the same words", async () => {
    const a = await new SmartSearch({ index, config: { judge: false } }).find({ text: "cooking cream for sauce" });
    const b = await new SmartSearch({ index, config: { judge: false } }).find({ text: "cooking cream for sauce" });
    expect(a.hits.map((h) => h.product.id)).toEqual(b.hits.map((h) => h.product.id));
  });
});

describe("smart search: recall", () => {
  it("corrects a word no product has to the nearest one that does", () => {
    expect(index.correct("whiping")).toBe("whipping");
    expect(editDistance("laktositon", "laktoositon", 2)).toBe(1);
  });

  it("finds products by the knowledge map's kinds", () => {
    const u = index.understand("something to whip");
    expect(index.matchKinds({ ...u, terms: ["whipping"] }).length).toBeGreaterThan(0);
  });

  it("vectors survive the compact file format and find the nearest product", () => {
    const ids = ["a", "b", "c"];
    const vecs = [Float32Array.from([1, 0, 0, 0]), Float32Array.from([0, 1, 0, 0]), Float32Array.from([0.7, 0.7, 0, 0])];
    const { data, scale } = quantise(vecs, 4);
    const meta = { format: "dock-search-vectors", version: 1, model: "test", dim: 4, builtAt: "2026-11-14T00:00:00Z", recipe: "test", count: 3, tokens: 0, costUsd: 0 } as const;
    const v: ProductVectors = parseVectorsBytes(encodeVectors(meta, ids, data, scale));
    expect(v.nearest(Float32Array.from([0.9, 0.1, 0, 0]), 2).map((n) => n.id)).toEqual(["a", "c"]);
    expect(v.nearest(Float32Array.from([0.9, 0.1, 0, 0]), 1, (id) => id !== "a").map((n) => n.id)).toEqual(["c"]);
  });
});
