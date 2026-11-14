import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockError } from "@/core/errors";
import { dailyUsage, resetDailyUsage } from "../limits";
import { interpretNeed, type LlmNeed } from "./interpret";
import { extraBodyFor, readTwice, secondReaderModel, unavailableReason } from "./second-reader";

/**
 * The second reader with scripted models: the comparison when it answers, and every way it can fail open. The first
 * reading is always the answer; the second only adds a record (and, on a material difference, a question later).
 */
const NOW = new Date("2026-11-13T12:00:00+02:00");
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
const answers = (out: LlmNeed, delayMs = 0): Gen => async () => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return JSON.stringify(out);
};
/** A model that never answers until its call is aborted. */
const hangs: Gen = (o) => new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))));

const first = (gen: Gen = answers(MILK)) => scripted("anthropic:claude-opus-5-5", gen);
const NEMO = "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
const second = (gen: Gen, seen?: LanguageModelV4CallOptions[]) => scripted(NEMO, gen, seen);

const run = (secondGen: Gen, opts: { deadlineMs?: number; firstGen?: Gen; seen?: LanguageModelV4CallOptions[] } = {}) =>
  readTwice(interpretNeed, { text: TEXT, now: NOW, model: first(opts.firstGen) }, { model: second(secondGen, opts.seen), deadlineMs: opts.deadlineMs ?? 2000 });

beforeEach(() => resetDailyUsage());
afterEach(() => {
  delete process.env.DOCK_LLM_DAILY_CALLS;
  resetDailyUsage();
});

describe("readTwice", () => {
  it("both readers agree: the first reading is the answer and the record says agreed, by which models", async () => {
    const r = await run(answers(MILK));
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "agreed", firstModel: "anthropic:claude-opus-5-5", secondModel: NEMO, differences: [] });
    expect(dailyUsage().llm.calls).toBe(2); // both calls count against the daily limits
  });

  it("they differ on the amount: the record names the field and both readings; the need is untouched", async () => {
    const r = await run(answers({ ...MILK, quantity: { amount: 1, unit: "L" } }));
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

  it("a slower first reading is not delayed by a late second reader beyond the deadline", async () => {
    const r = await run(hangs, { deadlineMs: 200, firstGen: answers(MILK, 400) });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "timeout", waitedMs: 0 });
  });

  it("over capacity (HTTP 429): unavailable, at_capacity", async () => {
    const busy: Gen = async () => {
      throw new APICallError({ message: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16 is temporarily at capacity.", url: "https://api.featherless.ai/v1/chat/completions", requestBodyValues: {}, statusCode: 429, isRetryable: true });
    };
    const r = await run(busy, { deadlineMs: 400 });
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "at_capacity" });
  });

  it("down (HTTP 500 every time): unavailable, failed", async () => {
    const down: Gen = async () => {
      throw new APICallError({ message: "Internal error", url: "x", requestBodyValues: {}, statusCode: 500, isRetryable: true });
    };
    expect((await run(down, { deadlineMs: 400 })).second).toMatchObject({ status: "unavailable" });
  });

  it("returns something unreadable: unavailable, unreadable", async () => {
    const r = await run(async () => "I think the buyer wants milk.");
    expect(r.second).toMatchObject({ status: "unavailable", reason: "unreadable" });
  });

  it("returns an impossible date: unavailable, unreadable", async () => {
    const r = await run(answers({ ...MILK, deliverBy: "2026-02-31" }));
    expect(r.second).toMatchObject({ status: "unavailable", reason: "unreadable" });
  });

  it("reads it as not a purchase: no question, recorded as unavailable", async () => {
    const r = await run(answers({ ...MILK, isPurchaseRequest: false, notPurchaseReason: "A question." }));
    expect(r.second).toMatchObject({ status: "unavailable", reason: "not_a_purchase" });
  });

  it("finds no amount (need_incomplete): the part it read is compared, and a missing amount is not a difference", async () => {
    const r = await run(answers({ ...MILK, quantity: null }));
    expect(r.second).toMatchObject({ status: "agreed" });
    expect(r.second!.minor[0]).toBe("the second reading was incomplete");
  });

  it("near the daily cap the second reader yields: the first reading still gets its call", async () => {
    process.env.DOCK_LLM_DAILY_CALLS = "10";
    const { reserveLlmCall } = await import("../limits");
    for (let i = 0; i < 9; i++) reserveLlmCall();
    const r = await run(answers(MILK));
    expect(r.first.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(r.second).toMatchObject({ status: "unavailable", reason: "over_limit" });
    expect(dailyUsage().llm.calls).toBe(10);
  });

  it("when the first reading fails, its error is the answer and the second call is cancelled", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    const failing: Gen = async () => {
      throw new APICallError({ message: "Bad request", url: "x", requestBodyValues: {}, statusCode: 400, isRetryable: false });
    };
    await expect(run(hangs, { firstGen: failing, seen })).rejects.toMatchObject({ code: "interpret_failed" });
    expect(seen[0].abortSignal?.aborted).toBe(true);
  });

  it("off without a model: the first reading alone, no record", async () => {
    const r = await readTwice(interpretNeed, { text: TEXT, now: NOW, model: first() }, { model: undefined });
    expect(r.second).toBeUndefined();
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
    expect(extraBodyFor("anthropic:claude-haiku-5-5")).toBeUndefined();
  });

  it("maps the interpreter's errors to a reason", () => {
    expect(unavailableReason(new DockError(504, "interpret_timeout", "late")).reason).toBe("timeout");
    expect(unavailableReason(new DockError(429, "demo_limit_reached", "cap")).reason).toBe("over_limit");
    expect(unavailableReason(new DockError(503, "model_unavailable", "no key")).reason).toBe("not_configured");
    expect(unavailableReason(new DockError(503, "interpret_failed", "The model call failed: HTTP 429: at capacity")).reason).toBe("at_capacity");
    expect(unavailableReason(new Error("boom")).reason).toBe("failed");
  });
});
