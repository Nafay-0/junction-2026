import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockError } from "@/core/errors";
import { dailyUsage, reserveLlmCall, resetDailyUsage } from "../limits";
import { interpretNeed, type LlmNeed } from "./interpret";
import { deliveryDay, extraBodyFor, readTwice, secondReaderModel, toReadings, unavailableReason, type SecondItem, type SecondRead } from "./second-reader";

/** The transcription with its one item changed. */
const item = (over: Partial<SecondItem>): SecondRead => ({ ...READ, items: [{ ...ITEM, ...over }] });

/**
 * The second reader with scripted models: the comparison when it answers, and every way it can fail open. The first
 * reading is always the answer; the second only adds a record (and, on a material difference, a question later).
 */
const NOW = new Date("2026-11-14T10:00:00+02:00"); // Saturday
const TEXT = "I need 1,000 litres of lactose-free milk by Monday.";
const MILK: LlmNeed = {
  isPurchaseRequest: true,
  notPurchaseReason: null,
  item: { text: "lactose-free milk", category: null, attributes: ["lactose_free"], excludedAttributes: [], productId: null },
  quantity: { amount: 1000, unit: "L" },
  deliverBy: "2026-11-16",
  requiredClaims: [],
  forbiddenAllergens: [],
  optimise: "unstated",
  sameAsLastTime: false,
};
const ITEM: SecondItem = { item: "lactose-free milk", amount: 1000, unit: "L", packSize: null, wanted: ["lactose_free"], notWanted: [], avoid: [] };
const READ: SecondRead = {
  isPurchaseRequest: true,
  items: [ITEM],
  deliveryDate: null,
  deliveryWeekday: "monday",
  deliveryRelative: null,
};

type Gen = (o: LanguageModelV4CallOptions) => Promise<string>;
function scripted(id: string, gen: Gen, seen: LanguageModelV4CallOptions[] = []) {
  const model = new MockLanguageModelV4({
    doGenerate: async (o) => {
      seen.push(o);
      const text = await gen(o);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 100, text: 100, reasoning: undefined } },
        warnings: [],
      };
    },
  });
  return { model, id, price: { inputPerM: 0.05, outputPerM: 0.2 } };
}
const answers =
  (out: unknown, delayMs = 0): Gen =>
  async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return JSON.stringify(out);
  };
/** A model that never answers until its call is aborted. */
const hangs: Gen = (o) => new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))));
const throws = (statusCode: number, message: string): Gen => async () => {
  throw new APICallError({ message, url: "https://api.featherless.ai/v1/chat/completions", requestBodyValues: {}, statusCode, isRetryable: statusCode >= 429 });
};

const NEMO = "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
const run = (secondGen: Gen, opts: { deadlineMs?: number; firstGen?: Gen; seen?: LanguageModelV4CallOptions[] } = {}) =>
  readTwice(interpretNeed, { text: TEXT, now: NOW, model: scripted("anthropic:claude-opus-5-5", opts.firstGen ?? answers(MILK)) }, { model: scripted(NEMO, secondGen, opts.seen), deadlineMs: opts.deadlineMs ?? 2000 });

beforeEach(() => resetDailyUsage());
afterEach(() => {
  delete process.env.DOCK_LLM_DAILY_CALLS;
  resetDailyUsage();
});

describe("readTwice", () => {
  it("both readers agree: the first reading is the answer and the record says agreed, by which models", async () => {
    const r = await run(answers(READ));
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "agreed", firstModel: "anthropic:claude-opus-5-5", secondModel: NEMO, differences: [] });
    expect(dailyUsage().llm.calls).toBe(2); // both calls count against the daily limits
  });

  it("they differ on the amount: the record names the field and both readings; the need is untouched", async () => {
    const r = await run(answers(item({ amount: 1 })));
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "differed", differences: [{ field: "amount", first: "1,000 L", second: "1 L" }] });
  });

  it("late: cut off at the deadline from the shared start, recorded as unavailable, and the first reading carries on", async () => {
    const t0 = Date.now();
    const r = await run(hangs, { deadlineMs: 300 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "timeout", differences: [] });
  });

  it("a slower first reading waits for nothing: the late second reader was already cut off", async () => {
    const r = await run(hangs, { deadlineMs: 200, firstGen: answers(MILK, 400) });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "timeout", waitedMs: 0 });
  });

  it("over capacity (HTTP 429): unavailable, at_capacity", async () => {
    const r = await run(throws(429, "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16 is temporarily at capacity."), { deadlineMs: 400 });
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "at_capacity" });
  });

  it("down (HTTP 500 every time): unavailable, failed", async () => {
    expect((await run(throws(500, "Internal error"), { deadlineMs: 400 })).second).toMatchObject({ status: "unavailable", reason: "failed" });
  });

  it("returns something unreadable: unavailable, unreadable", async () => {
    expect((await run(async () => "I think the buyer wants milk.")).second).toMatchObject({ status: "unavailable", reason: "unreadable" });
    expect((await run(answers(item({ unit: "litres" as never })))).second).toMatchObject({ status: "unavailable", reason: "unreadable" });
  });

  it("reads it as not a purchase: no question, recorded as unavailable", async () => {
    expect((await run(answers({ ...READ, isPurchaseRequest: false }))).second).toMatchObject({ status: "unavailable", reason: "not_a_purchase" });
  });

  it("finds no amount: a missing amount in the second reading is not a difference", async () => {
    const r = await run(answers(item({ amount: null, unit: null })));
    expect(r.second).toMatchObject({ status: "agreed" });
  });

  it("near the daily cap the second reader yields: the first reading still gets its call", async () => {
    process.env.DOCK_LLM_DAILY_CALLS = "10";
    for (let i = 0; i < 9; i++) reserveLlmCall();
    const r = await run(answers(READ));
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "over_limit" });
    expect(dailyUsage().llm.calls).toBe(10);
  });

  it("when the first reading fails, its error is the answer and the second call is cancelled", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    await expect(run(hangs, { firstGen: throws(400, "Bad request"), seen })).rejects.toMatchObject({ code: "interpret_failed" });
    expect(seen[0].abortSignal?.aborted).toBe(true);
  });

  it("several items: the second reading of the same item is compared, and the others are no disagreement", async () => {
    const text = "I need 1,000 litres of lactose-free milk and 20 kg of butter by Monday.";
    const both: SecondRead = { ...READ, items: [{ ...ITEM, item: "butter", amount: 20, unit: "kg", wanted: [] }, ITEM] };
    const r = await readTwice(interpretNeed, { text, now: NOW, model: scripted("first", answers(MILK)) }, { model: scripted(NEMO, answers(both)), deadlineMs: 2000 });
    expect(r.second).toMatchObject({ status: "agreed" });
    expect(r.second!.minor[0]).toMatch(/only the same item is compared/);
    // The second reader read only the butter: nothing to compare, and no question.
    const butter: SecondRead = { ...READ, items: [{ ...ITEM, item: "butter", amount: 20, unit: "kg", wanted: [] }] };
    const r2 = await readTwice(interpretNeed, { text, now: NOW, model: scripted("first", answers(MILK)) }, { model: scripted(NEMO, answers(butter)), deadlineMs: 2000 });
    expect(r2.second).toMatchObject({ status: "unavailable", reason: "other_item", differences: [] });
  });

  it("the same again on another day: the day is not compared", async () => {
    const text = "I need 1,000 litres of lactose-free milk by Monday, and the same again on Thursday.";
    const thursday: SecondRead = { ...READ, deliveryWeekday: "thursday" };
    const r = await readTwice(interpretNeed, { text, now: NOW, model: scripted("first", answers(MILK)) }, { model: scripted(NEMO, answers(thursday)), deadlineMs: 2000 });
    expect(r.second).toMatchObject({ status: "agreed" });
  });

  it("off without a model: the first reading alone, no record", async () => {
    const r = await readTwice(interpretNeed, { text: TEXT, now: NOW, model: scripted("first", answers(MILK)) }, { model: undefined });
    expect(r.second).toBeUndefined();
  });

  it("an unknown provider is recorded as not configured, and the first reading carries on", async () => {
    const r = await readTwice(interpretNeed, { text: TEXT, now: NOW, model: scripted("first", answers(MILK)) }, { model: "nowhere:model" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "not_configured" });
  });
});

describe("the transcription, by plain code", () => {
  it("resolves the day: a weekday is the next one after today, as the interpreter's rule says", () => {
    const d = (x: Partial<Pick<SecondRead, "deliveryDate" | "deliveryWeekday" | "deliveryRelative">>) => deliveryDay({ deliveryDate: null, deliveryWeekday: null, deliveryRelative: null, ...x }, NOW);
    expect(d({ deliveryWeekday: "monday" })).toBe("2026-11-16");
    expect(d({ deliveryWeekday: "saturday" })).toBe("2026-11-21"); // today is Saturday: the next one
    expect(d({ deliveryRelative: "tomorrow" })).toBe("2026-11-15");
    expect(d({ deliveryRelative: "day_after_tomorrow" })).toBe("2026-11-16");
    expect(d({ deliveryDate: { day: 16, month: 11 } })).toBe("2026-11-16");
    expect(d({ deliveryDate: { day: 20, month: null }, deliveryWeekday: "friday" })).toBe("2026-11-20"); // a written date first
    expect(d({ deliveryDate: { day: 3, month: null } })).toBe("2026-12-03"); // past this month: next month
    expect(d({ deliveryDate: { day: 31, month: 2 } })).toBeUndefined();
    expect(d({})).toBeUndefined();
  });

  it("packs with a written pack size keep the size, for the comparison", () => {
    const [r] = toReadings(item({ amount: 100, unit: "pack", packSize: { amount: 10, unit: "L" } }), NOW);
    expect(r).toMatchObject({ quantity: { amount: 100, unit: "pack" }, packSize: { amount: 10, unit: "L" } });
  });

  it("a claim both wanted and not wanted counts as not wanted", () => {
    expect(toReadings(item({ wanted: ["lactose_free"], notWanted: ["lactose_free"] }), NOW)[0].item).toMatchObject({ attributes: [], excludedAttributes: ["lactose_free"] });
  });
});

describe("configuration", () => {
  it("DOCK_SECOND_READER_MODEL picks the model; empty turns it off", () => {
    expect(secondReaderModel({ DOCK_SECOND_READER_MODEL: NEMO })).toBe(NEMO);
    expect(secondReaderModel({ DOCK_SECOND_READER_MODEL: " " })).toBeUndefined();
    expect(secondReaderModel({})).toBeUndefined();
  });

  it("Nemotron 3 gets thinking switched off; other models get nothing extra", () => {
    expect(extraBodyFor(NEMO)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(extraBodyFor(`${NEMO}#think`)).toBeUndefined();
    expect(extraBodyFor("anthropic:claude-haiku-5-5")).toBeUndefined();
  });

  it("maps errors to a reason", () => {
    expect(unavailableReason(new Error("late"), true).reason).toBe("timeout");
    expect(unavailableReason(new DockError(429, "demo_limit_reached", "cap")).reason).toBe("over_limit");
    expect(unavailableReason(new APICallError({ message: "at capacity", url: "x", requestBodyValues: {}, statusCode: 429 })).reason).toBe("at_capacity");
    expect(unavailableReason(new Error("boom")).reason).toBe("failed");
  });
});
