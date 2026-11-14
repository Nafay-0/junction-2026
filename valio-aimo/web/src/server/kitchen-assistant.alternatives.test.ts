import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA F-ASSIST-NO-SUBSTITUTE: "Suggest a substitute for this cream" must use the product map, within the kitchen's
 * own rules (Kaari's stated "Always lactose-free"), and say the map's reason when there is no good alternative.
 * The map is stubbed here so the test runs on the seed catalogue; the records it hands the model are checked.
 */
const calls: { productId: string; q: { requiredClaims: string[]; forbiddenAllergens: string[]; text?: string } }[] = [];
let answer: unknown;
vi.mock("./knowledge/service", () => ({
  alternativesSource: () => async (productId: string, q: { requiredClaims: string[]; forbiddenAllergens: string[]; text?: string }) => {
    calls.push({ productId, q });
    return answer;
  },
}));
const seen: { id: string; data: Record<string, unknown> }[][] = [];
vi.mock("./agent/assistant", () => ({
  askAssistant: async (o: { records: { id: string; data: Record<string, unknown> }[] }) => {
    seen.push(o.records);
    return { kind: "answer", answer: "ok", citations: [], dataMissing: false, model: "scripted", ms: 1 };
  },
}));

const { ask } = await import("./kitchen-assistant");
const { resolveKitchen } = await import("./console-kitchens");
const { resetRuntime } = await import("./runtime");

describe("the assistant's alternatives come from the product map, within the kitchen's rules", () => {
  beforeEach(() => {
    resetRuntime();
    vi.stubEnv("DOCK_CATALOG", "seed");
    calls.length = 0;
    seen.length = 0;
  });

  it("asks the map with the kitchen's stated lactose-free rule and hands the model only what the map ranks, with tier and reason", async () => {
    answer = { substitutes: [{ productId: "VA-1201", tier: "better", reason: "Same family; still lactose-free.", otherPacks: [] }], packAlternatives: [], use: "whipping" };
    const k = await resolveKitchen("kaari");
    await ask(k!, { question: "Suggest a substitute for this cream for whipping desserts.", productId: "VA-2301" });
    expect(calls[0].productId).toBe("VA-2301");
    expect(calls[0].q.requiredClaims).toContain("lactose_free");
    const alt = seen[0].filter((r) => r.data.alternativeTo === "VA-2301");
    expect(alt.map((r) => [r.id, r.data.rankedByProductMap, r.data.whyItFits])).toEqual([["product:VA-1201", "better", "Same family; still lactose-free."]]);
  });

  it("with no good alternative, the model gets the map's reason and no padded products", async () => {
    answer = { substitutes: [], packAlternatives: [], none: "No substitute for whipping that is also lactose-free." };
    const k = await resolveKitchen("kaari");
    await ask(k!, { question: "What is an alternative to this?", productId: "VA-2301" });
    const none = seen[0].find((r) => r.id === "alternatives:VA-2301")!;
    expect(none.data.noGoodAlternative).toBe("No substitute for whipping that is also lactose-free.");
    expect(seen[0].filter((r) => r.id.startsWith("product:") && r.id !== "product:VA-2301" && r.data.alternativeTo)).toEqual([]);
  });
});
