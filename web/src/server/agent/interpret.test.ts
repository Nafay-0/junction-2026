import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as interpretRoute } from "@/app/api/v1/agent/interpret/route";
import { DockError } from "@/core/errors";
import { signMandate } from "@/core/mandate";
import { NeedSchema } from "@/core/need";
import { SEED_PRODUCTS } from "@/core/seed";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { resetRuntime } from "../runtime";
import { calendar, checkBasedOn, interpretNeed, toNeed, vocabularyFrom, type EarlierRequest, type LlmFollowUp, type LlmNeed } from "./interpret";

/**
 * Outputs recorded from live runs on 2026-11-13 (now = Friday 2026-11-13 12:00 Helsinki). Haiku 5.5,
 * GPT-6 Luna and Gemini 3.1 Flash-Lite returned the same fields for each of these texts; the Finnish
 * item text "maitoa" and the null productId are as the models wrote them.
 */
const NOW = new Date("2026-11-13T12:00:00+02:00");
const MILK = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
const empty = { notPurchaseReason: null, requiredClaims: [], forbiddenAllergens: [], sameAsLastTime: false };
const RECORDED: Record<string, LlmNeed> = {
  [MILK]: {
    ...empty,
    isPurchaseRequest: true,
    item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null },
    quantity: { amount: 1000, unit: "L" },
    deliverBy: "2026-11-16",
    optimise: "price",
  },
  "Tarvitsen 200 litraa maitoa perjantaiksi.": {
    ...empty,
    isPurchaseRequest: true,
    item: { text: "maitoa", category: "milk", attributes: [], excludedAttributes: [], productId: null },
    quantity: { amount: 200, unit: "L" },
    deliverBy: "2026-11-20",
    optimise: "unstated",
  },
  "Vi behöver 30 kartonger laktosfri mjölk till måndag, billigast möjliga.": {
    ...empty,
    isPurchaseRequest: true,
    item: { text: "laktosfri mjölk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null },
    quantity: { amount: 30, unit: "pack" },
    deliverBy: "2026-11-16",
    optimise: "price",
  },
  "What time do you deliver on Saturdays?": {
    ...empty,
    isPurchaseRequest: false,
    notPurchaseReason: "The buyer is asking about delivery times on Saturdays, not requesting a purchase.",
    item: { text: null, category: null, attributes: [], excludedAttributes: [], productId: null },
    quantity: null,
    deliverBy: null,
    optimise: "unstated",
  },
  "Lactose-free milk for next Tuesday please": {
    ...empty,
    isPurchaseRequest: true,
    item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null },
    quantity: null,
    deliverBy: "2026-11-17",
    optimise: "unstated",
  },
};

function replay(output: LlmNeed | LlmFollowUp, seen: LanguageModelV4CallOptions[] = []) {
  const model = new MockLanguageModelV4({
    doGenerate: async (o) => {
      seen.push(o);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1200, noCache: 1200, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 150, text: 150, reasoning: undefined } },
        warnings: [],
      };
    },
  });
  return { model, id: "recorded:model", price: { inputPerM: 0.1, outputPerM: 0.5 } };
}

const interpret = (text: string, seen?: LanguageModelV4CallOptions[]) => interpretNeed({ text, now: NOW, model: replay(RECORDED[text], seen) });

describe("interpret (recorded model outputs)", () => {
  it("the milk example: the buyer's words kept, Monday resolved, nothing added", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    const r = await interpretNeed({ text: MILK, now: NOW, model: replay(RECORDED[MILK], seen), vocabulary: vocabularyFrom(SEED_PRODUCTS) });
    expect(NeedSchema.safeParse(r.need).success).toBe(true);
    expect(r.need).toEqual({
      text: MILK,
      item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [] },
      quantity: { amount: 1000, unit: "L" },
      deliverBy: "2026-11-16",
      requiredClaims: [],
      forbiddenAllergens: [],
      optimise: "price",
      sameAsLastTime: false,
    });
    expect(r.model).toBe("recorded:model");
    expect(r.costUsd).toBeCloseTo(0.000195, 6);
    // What the model was given: the vocabulary, the calendar in three languages, the text verbatim.
    const prompt = JSON.stringify(seen[0].prompt);
    expect(prompt).toContain("lactose_free");
    expect(prompt).toContain("2026-11-16 Monday (maanantai, måndag)");
    expect(prompt).toContain(MILK.replaceAll('"', '\\"'));
  });

  it("Finnish: an unstated fat content, lactose and preference stay unstated", async () => {
    const { need } = await interpret("Tarvitsen 200 litraa maitoa perjantaiksi.");
    expect(need).toMatchObject({ item: { text: "maitoa", category: "milk", attributes: [] }, quantity: { amount: 200, unit: "L" }, deliverBy: "2026-11-20", optimise: "unstated" });
  });

  it("Swedish: cartons become packs, 'billigast' becomes optimise price", async () => {
    const { need } = await interpret("Vi behöver 30 kartonger laktosfri mjölk till måndag, billigast möjliga.");
    expect(need).toMatchObject({ item: { text: "laktosfri mjölk", attributes: ["lactose_free"] }, quantity: { amount: 30, unit: "pack" }, deliverBy: "2026-11-16", optimise: "price" });
  });

  it("not a purchasing request: a structured 422 with the model's reason", async () => {
    await expect(interpret("What time do you deliver on Saturdays?")).rejects.toMatchObject({ status: 422, code: "not_a_purchase_request" });
  });

  it("no amount: a structured 422 naming what is missing, with the partial need", async () => {
    const err = (await interpret("Lactose-free milk for next Tuesday please").catch((e) => e)) as DockError;
    expect(err).toMatchObject({ status: 422, code: "need_incomplete", details: { missing: ["quantity"] } });
    expect((err.details as { partial: { deliverBy: string } }).partial.deliverBy).toBe("2026-11-17");
  });
});

describe("follow-ups against an earlier request", () => {
  const EARLIER: EarlierRequest[] = [
    {
      id: "req_thu",
      at: "2026-11-11T08:10:00.000Z",
      text: "100 litres of lactose-free milk for Thursday",
      need: { item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free", "fat_1_5"] }, quantity: { amount: 100, unit: "L" }, deliverBy: "2026-11-12", optimise: "price" },
      ordered: "100 x Valio Eila 1.5 %, 1 L",
      deliveredOn: "2026-11-12",
    },
  ];
  const sameAgain: LlmFollowUp = {
    ...empty,
    isPurchaseRequest: true,
    item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free", "fat_1_5"], excludedAttributes: [], productId: null },
    quantity: { amount: 200, unit: "L" },
    deliverBy: null,
    optimise: "price",
    basedOnRequestId: "req_thu",
    takenFromEarlier: ["item", "attributes", "optimise"],
  };

  it("passes the earlier requests to the model and returns which one the need was built on", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    const r = await interpretNeed({ text: "same again but 200 litres", now: NOW, model: replay(sameAgain, seen), earlier: EARLIER });
    expect(r.need).toMatchObject({ text: "same again but 200 litres", item: { text: "lactose-free milk", attributes: ["lactose_free", "fat_1_5"] }, quantity: { amount: 200, unit: "L" }, optimise: "price" });
    expect(r.need.deliverBy).toBeUndefined();
    expect(r.basedOn).toEqual({ requestId: "req_thu", fields: ["item", "attributes", "optimise"] });
    const prompt = JSON.stringify(seen[0].prompt);
    expect(prompt).toContain("req_thu");
    expect(prompt).toContain("delivered Thursday 2026-11-12");
  });

  it("drops a reference to a request it was not given", () => {
    expect(checkBasedOn({ basedOnRequestId: "req_made_up", takenFromEarlier: ["item"] }, EARLIER)).toBeUndefined();
    expect(checkBasedOn({ basedOnRequestId: null, takenFromEarlier: [] }, EARLIER)).toBeUndefined();
  });

  it("without earlier requests the plain schema is used and nothing is based on memory", async () => {
    const r = await interpret("Tarvitsen 200 litraa maitoa perjantaiksi.");
    expect(r.basedOn).toBeUndefined();
  });
});

describe("toNeed (plain code after the model)", () => {
  const base = RECORDED[MILK];

  it("normalises tags and drops a tag that is both wanted and excluded from the excluded side", () => {
    const n = toNeed({ ...base, item: { ...base.item, attributes: ["Lactose-free", "lactose_free"], excludedAttributes: ["lactose free", "Organic"] }, forbiddenAllergens: ["Gluten"] }, "x");
    expect(n.item.attributes).toEqual(["lactose_free"]);
    expect(n.item.excludedAttributes).toEqual(["organic"]);
    expect(n.forbiddenAllergens).toEqual(["gluten"]);
  });

  it("keeps the input text, not anything the model wrote", () => {
    expect(toNeed(base, "  the buyer's exact words ").text).toBe("  the buyer's exact words ");
  });

  it("refuses an impossible date as invalid model output", () => {
    expect(() => toNeed({ ...base, deliverBy: "2026-02-30" }, "x")).toThrow(expect.objectContaining({ status: 502, code: "interpret_invalid_output" }));
    expect(() => toNeed({ ...base, deliverBy: "Monday" }, "x")).toThrow(expect.objectContaining({ code: "interpret_invalid_output" }));
  });

  it("same as last time needs no quantity", () => {
    const n = toNeed({ ...base, quantity: null, sameAsLastTime: true }, "same as last time");
    expect(n).toMatchObject({ sameAsLastTime: true });
    expect(n.quantity).toBeUndefined();
  });

  it("the calendar starts tomorrow in Helsinki time, even late in the UTC evening", () => {
    const c = calendar(new Date("2026-11-15T22:30:00Z")); // already Monday 00:30 in Helsinki
    expect(c).toMatch(/^Today is Monday 2026-11-16/);
    expect(c).toContain("2026-11-23 Monday (maanantai, måndag)");
  });
});

describe("POST /api/v1/agent/interpret", () => {
  const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "DOCK_INTERPRET_MODEL"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    resetRuntime();
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
  });

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await interpretRoute(new Request("http://dock.test/api/v1/agent/interpret", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };

  it("needs a mandate like every agent route, validates the body, and says when no model is configured", async () => {
    expect((await post({ text: MILK })).status).toBe(401);
    const mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
    const auth = { authorization: `Bearer ${mandate}`, "dock-agent-id": DEMO_ORG.agentId };
    expect((await post({ text: "" }, auth)).body.error.code).toBe("invalid_request");
    const r = await post({ text: MILK }, auth);
    expect(r).toMatchObject({ status: 503, body: { error: { code: "model_unavailable" } } });
  });
});
