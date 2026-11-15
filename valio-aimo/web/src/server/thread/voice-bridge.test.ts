import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calls, voiceLimits } from "@/server/channels/voice/calls";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { threadStore } from "./engine";
import { heardTurn, isEcho, isFragment, nextSpoken, numbersDisagree, progressFor } from "./voice-bridge";
import type { AgentTurn } from "./types";

/** The voice door's own guards, all plain code, before anything reaches the conversation. */

const usage = { inputTokens: { total: 9, noCache: 9, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 3, text: 3, reasoning: undefined } };
const says = (text: string) => ({
  id: "anthropic:scripted",
  model: new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "scripted",
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text }, { type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }];
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  }),
});

beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockCalls?: unknown; __dockThreads?: unknown }).__dockCalls = undefined;
  (globalThis as { __dockThreads?: unknown }).__dockThreads = undefined;
  process.env.DOCK_MEMORY = "off";
});
afterEach(() => {
  setAgentModelForTests(undefined);
  delete process.env.DOCK_MEMORY;
});

const open = () => calls().open("laakso", "hands_free", voiceLimits({}));

describe("the voice door's guards", () => {
  it("sends the heard words into the conversation as the buyer's own spoken turn, and records them as heard", async () => {
    setAgentModelForTests(says("What do you need?"));
    const call = open();
    let s = await heardTurn("laakso", call, { text: "hello, what can you do", turn: 1, modelWords: "hello what can you do" });
    while (s.state === "working") s = await nextSpoken("laakso", call, s.agentTurnId!, 5_000);
    expect(s.say, s.say).toContain("What do you need?");
    const t = (await threadStore()).peek("laakso")!;
    expect(t.turns.find((x) => x.role === "buyer")).toMatchObject({ door: "voice", via: "speech", text: "hello, what can you do" });
    const heard = (await getRuntime()).dock.ledger.entries().find((e) => (e.data as { event?: string }).event === "heard");
    expect(heard?.data).toMatchObject({ door: "voice", heard: "hello, what can you do", model: "hello what can you do" });
  });

  it("never uses the same words twice", async () => {
    setAgentModelForTests(says("OK."));
    const call = open();
    await heardTurn("laakso", call, { text: "what did we order last week", turn: 3 });
    expect(await heardTurn("laakso", call, { text: "yes, order it", turn: 3 })).toMatchObject({ state: "ignored", why: "words_already_used" });
    expect(await heardTurn("laakso", call, { text: "yes, order it", turn: 2 })).toMatchObject({ state: "ignored", why: "words_already_used" });
  });

  it("does not take its own words, heard back from the speaker, as the buyer's", () => {
    const said = [{ text: "3 options. The first: Valio Eila milk, 25 euros 80, for Monday. Shall I order the first one?", at: Date.now() }];
    expect(isEcho("the first Valio Eila milk 25 euros 80 for Monday", said)).toBe(true);
    // A buyer who repeats a few words of the question is not an echo.
    expect(isEcho("the first one", said)).toBe(false);
    expect(isEcho("no, the cheapest one for Tuesday please", said)).toBe(false);
  });

  it("asks again about a yes that began while its own question was still playing", async () => {
    const call = open();
    call.desk.said.push({ text: "Shall I order it?", at: Date.now() });
    const s = await heardTurn("laakso", call, { text: "yes", turn: 1, overlap: true, duringAgent: true });
    expect(s).toMatchObject({ state: "asked", why: "overlap" });
    expect((await threadStore()).peek("laakso")?.turns.length ?? 0).toBe(0);
  });

  it("asks when the transcript and the voice model heard different numbers, and sends nothing", async () => {
    expect(numbersDisagree("fifteen litres of milk", "50 litres of milk")).toEqual({ heard: [15], model: [50] });
    expect(numbersDisagree("15 litres of milk", "fifteen litres of milk")).toBeUndefined();
    const call = open();
    const s = await heardTurn("laakso", call, { text: "fifteen litres of milk for Monday", turn: 1, modelWords: "fifty litres of milk for Monday" });
    expect(s).toMatchObject({ state: "asked", why: "numbers_disagree" });
    expect(s.say).toMatch(/15 litres or 50 litres/);
    expect((await threadStore()).peek("laakso")?.turns.length ?? 0).toBe(0);
  });

  it("says goodbye, and stops speaking about work in progress when told to stop", async () => {
    const call = open();
    expect(await heardTurn("laakso", call, { text: "thanks, bye", turn: 1 })).toMatchObject({ state: "goodbye", say: "Goodbye." });
    expect(await heardTurn("laakso", call, { text: "never mind", turn: 2 })).toMatchObject({ state: "stopped", say: "OK." });
    expect(await heardTurn("laakso", call, { text: "kiitos hei hei", turn: 3 })).toMatchObject({ state: "goodbye", say: "Hei hei." });
    // "stop the emails" is a request, not a stop.
    setAgentModelForTests(says("OK."));
    expect((await heardTurn("laakso", call, { text: "stop the emails", turn: 4 })).state).not.toBe("stopped");
  });

  it("never acts on a fragment cut off by talking over the agent; asks again", async () => {
    expect(isFragment("The")).toBe(true);
    expect(isFragment("um, the")).toBe(true);
    for (const answer of ["yes", "no", "OK", "joo", "ei", "ja", "The first one", "200"]) expect(isFragment(answer), answer).toBe(false);
    const call = open();
    const s = await heardTurn("laakso", call, { text: "The", turn: 1, duringAgent: true });
    expect(s).toMatchObject({ state: "asked", why: "fragment" });
    expect(s.say).toMatch(/only caught "The"/);
    expect((await threadStore()).peek("laakso")?.turns.length ?? 0).toBe(0);
  });

  it("is never silent on long work: a new step after three seconds, the same one after seven, never the same words twice", () => {
    const step = (kind: string, status: "running" | "done" = "running") => ({ stepId: kind, kind, label: kind, status, startedAt: "" });
    const a = (steps: ReturnType<typeof step>[]): AgentTurn => ({ turnId: "t", role: "agent", at: "", replyTo: "b", status: "working", steps, cards: [] });
    const p = { keys: ["step:read"], at: 0, last: "Reading that." };
    expect(progressFor(a([step("read")]), p, 2_000, "en")).toBeUndefined();
    expect(progressFor(a([step("read", "done"), step("lookup")]), p, 3_100, "en")).toEqual({ key: "step:lookup", say: "Checking live prices and the day." });
    const q = { keys: ["step:read", "step:lookup"], at: 3_100, last: "Checking live prices and the day." };
    expect(progressFor(a([step("read", "done"), step("lookup")]), q, 6_000, "en")).toBeUndefined();
    expect(progressFor(a([step("read", "done"), step("lookup")]), q, 10_200, "en")?.say).toBe("Still waiting for the wholesaler's live prices.");
    const r = { keys: [...q.keys, "still:lookup"], at: 10_200, last: "Still waiting for the wholesaler's live prices." };
    expect(progressFor(a([step("read", "done"), step("lookup")]), r, 30_000, "en")).toBeUndefined();
    // A turn still queued behind another says nothing of its own.
    expect(progressFor(a([]), { keys: [], at: 0 }, 30_000, "en")).toBeUndefined();
  });

  it("a request spoken while another works: told it comes next, then really done, in order, and said", async () => {
    let calls = 0;
    const slow = {
      id: "anthropic:scripted",
      model: new MockLanguageModelV4({
        provider: "anthropic.messages",
        modelId: "scripted",
        doStream: async () => {
          const n = ++calls;
          if (n === 1) await new Promise((r) => setTimeout(r, 1_500));
          const text = n === 1 ? "First answer." : "Second answer.";
          const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text }, { type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }];
          return { stream: new ReadableStream({ start: (c) => (parts.forEach((x) => c.enqueue(x)), c.close()) }) };
        },
      }),
    };
    setAgentModelForTests(slow);
    const call = open();
    const one = await heardTurn("laakso", call, { text: "what did we order last week", turn: 1 });
    const two = await heardTurn("laakso", call, { text: "and what is our budget this week", turn: 2 });
    expect(two.say).toBe("I'll finish the one before first, then this.");
    const said: string[] = [];
    const follow = async (id: string) => {
      for (let i = 0; i < 20; i++) {
        const s = await nextSpoken("laakso", call, id, 5_000);
        if (s.state !== "working") return said.push(s.say);
      }
    };
    await Promise.all([follow(one.agentTurnId!), follow(two.agentTurnId!)]);
    expect(said.map((x) => (x.includes("First") ? 1 : x.includes("Second") ? 2 : 0))).toEqual([1, 2]);
  }, 30_000);
});
