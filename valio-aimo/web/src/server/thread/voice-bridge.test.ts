import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calls, voiceLimits } from "@/server/channels/voice/calls";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { threadStore } from "./engine";
import { heardTurn, isEcho, nextSpoken, numbersDisagree } from "./voice-bridge";

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
});
