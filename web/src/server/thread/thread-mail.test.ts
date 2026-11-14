import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localNow } from "@/core/kitchen";
import { setInterpretModelForTests } from "@/server/agent/interpret";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { resolveKitchen } from "@/server/console-kitchens";
import { setAddress, setMailTransport } from "@/server/notify/service";
import { FakeTransport } from "@/server/notify/transport";
import { setAgentModelForTests } from "./agent";
import { submitTurn, threadStore } from "./engine";
import type { Card, ThreadEvent } from "./types";

// ---------- scripted models ----------

const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 30, text: 30, reasoning: undefined } };

type Turn = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] } | ((o: LanguageModelV4CallOptions) => { text?: string; calls?: { name: string; args: Record<string, unknown> }[] });

/** A streaming stand-in for the agent's model: each step is the next turn of the script. */
function agentScript(turns: Turn[]) {
  let i = 0;
  let n = 0;
  const model = new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "scripted-agent",
    doStream: async (options) => {
      const def = turns[Math.min(i++, turns.length - 1)];
      const t = typeof def === "function" ? def(options) : def;
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (t.text) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t.text }, { type: "text-end", id: "t" });
      for (const c of t.calls ?? []) parts.push({ type: "tool-call", toolCallId: `c${++n}`, toolName: c.name, input: JSON.stringify(c.args) });
      parts.push({ type: "finish", finishReason: { unified: t.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  });
  return { model, id: "anthropic:scripted-agent" };
}

function nextWeekday(name: number): string {
  const today = localNow(new Date()).date;
  for (let k = 1; k <= 7; k++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k);
    if ((d.getUTCDay() || 7) === name) return d.toISOString().slice(0, 10);
  }
  return today;
}

/** The request reader, answering one fixed need (lactose-free milk), as the structured output the reader asks for. */
function reader(amount: number) {
  const need = {
    isPurchaseRequest: true,
    notPurchaseReason: null,
    item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null },
    quantity: { amount, unit: "L" },
    deliverBy: nextWeekday(1),
    requiredClaims: ["lactose_free"],
    forbiddenAllergens: [],
    optimise: "unstated",
    sameAsLastTime: false,
    basedOnRequestId: null,
    takenFromEarlier: [],
  };
  const model = new MockLanguageModelV4({
    provider: "scripted",
    modelId: "reader",
    doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(need) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }),
  });
  return { model, id: "scripted:reader" };
}

async function turn(kitchen: string, body: Record<string, unknown>): Promise<{ cards: Card[]; status: string; line?: string; events: ThreadEvent[] }> {
  const store = await threadStore();
  const events: ThreadEvent[] = [];
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(kitchen, (e) => {
      events.push(e);
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  const reply = await submitTurn(kitchen, body);
  id = reply.agentTurnId;
  await done;
  const a = store.agentTurn(store.peek(kitchen)!, id)!;
  return { cards: a.cards, status: a.status, line: a.line, events };
}

describe("order emails in the conversation", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
    process.env.DOCK_RATE_LIMITS = "off";
  });
  afterEach(() => {
    setAgentModelForTests(undefined);
    setInterpretModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
  });

  it("after an order placed by a tap on an earlier card, one sentence about the receipt follows the order's own words, masked", async () => {
    const rt = await getRuntime();
    setMailTransport(rt, new FakeTransport());
    const k = (await resolveKitchen("laakso"))!;
    await setAddress(rt, { orgId: k.info.orgId, slug: "laakso", name: k.info.name }, "chef@example.com", { by: "Test", via: "test", lang: "en" });
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "Two options below. Which one?" }, { text: "I've ordered the milk for Monday." }]));
    const first = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    const options = first.cards.find((c) => c.type === "options");
    if (options?.type !== "options") throw new Error("no options");
    const second = await turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId }, label: "Order this" });
    const order = second.cards.find((c) => c.type === "order");
    expect(order?.type === "order" && ["committed", "pending_approval"].includes(order.status)).toBe(true);
    const line = second.line ?? "";
    expect(line).toMatch(/c•••@example\.com/);
    expect(line).not.toContain("chef@example.com");
    const sentences = line.split(/(?<=[.!?])\s+/);
    expect(sentences.findIndex((s) => /@/.test(s))).toBeGreaterThan(0);
    expect(sentences.filter((s) => /@/.test(s))).toHaveLength(1);
  });
});
