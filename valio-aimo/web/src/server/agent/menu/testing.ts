import { MockLanguageModelV4 } from "ai/test";
import type { LlmMenuDraft } from "./draft";

/** Tests: the planner's model answering with one draft (the outline call, then each dish call). No provider is called. */
export function scriptedPlanner(raw: LlmMenuDraft) {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
  const model = new MockLanguageModelV4({
    doGenerate: async (o) => {
      const text = JSON.stringify(o.prompt);
      const body = text.includes("ONE dish")
        ? { ingredients: (raw.dishes.find((x) => text.includes(`The dish: ${x.name}`)) ?? raw.dishes[0]).ingredients, conflicts: [] }
        : { ...raw, dishes: raw.dishes.map(({ ingredients: _i, ...d }) => (void _i, d)), alternatives: [] };
      return { content: [{ type: "text", text: JSON.stringify(body) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, id: "scripted:menu" };
}

/** A one-dish draft of plain lactose-free milk: plans on the seed catalogue under any dairy mandate. */
export const MILK_DRAFT: LlmMenuDraft = {
  isFoodOrderRequest: true,
  declineReason: null,
  covers: 40,
  serviceDate: null,
  occasion: "lunch",
  requiredClaims: [],
  forbiddenAllergens: [],
  assumptions: [],
  conflicts: [],
  dishes: [{ name: "Milk with lunch", nameFi: null, course: "drink", serviceDate: null, portion: "2.5 dl", method: "Served cold.", ingredients: [{ key: "milk", name: "Lactose-free milk", searchTerms: ["lactose-free milk", "laktoositon maito"], role: "the drink", perCover: { amount: 250, unit: "ml" }, yieldPct: 100, amountBasis: "a glass", pantry: false, form: "any", avoid: [] }] }],
};
