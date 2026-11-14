import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localNow } from "@/core/kitchen";
import { setInterpretModelForTests } from "@/server/agent/interpret";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { submitTurn, threadStore } from "./engine";
import { withFallback } from "./fallback";
import { ThreadStore } from "./store";
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

describe("the agent thread", () => {
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

  it("reads the words, shows options as cards, and a tap orders the chosen card through the gate", async () => {
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "Three options below, all lactose-free." }]));
    const first = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    const types = first.cards.map((c) => c.type);
    expect(types).toContain("understood");
    expect(types).toContain("options");
    expect(first.status).toBe("waiting_buyer");
    expect(first.line).toBe("Three options below, all lactose-free.");
    // The first visible sign of work is a step, before any model call.
    const firstStep = first.events.find((e) => e.type === "step");
    expect(firstStep).toBeTruthy();

    const options = first.cards.find((c) => c.type === "options");
    if (options?.type !== "options") throw new Error("no options");
    const second = await turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId }, label: "Order this" });
    const gate = second.cards.find((c) => c.type === "gate");
    expect(gate?.type === "gate" && ["placed_alone", "waiting"]).toBeTruthy();
    expect(second.cards.some((c) => c.type === "order")).toBe(true);

    // Every step of the conversation is in the ledger, tagged with the thread and the door.
    const rt = await getRuntime();
    const agentEntries = rt.dock.ledger.entries().filter((e) => e.type === "agent");
    expect(agentEntries.some((e) => (e.data as { event?: string }).event === "turn")).toBe(true);
    expect(agentEntries.every((e) => (e.data as { thread?: { threadId?: string } }).thread?.threadId)).toBe(true);
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("holds back a sentence that states a price no record backs", async () => {
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "The cheapest is €3.99 a litre." }]));
    const r = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    expect(r.line).toBeUndefined();
    const rt = await getRuntime();
    expect(rt.dock.ledger.entries().some((e) => e.type === "agent" && (e.data as { event?: string }).event === "grounding_refusal")).toBe(true);
  });

  it("maps the buyer's words onto an open card only through buyer_reply, and refuses a ref that is not open", async () => {
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "Options below." }]));
    await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    let saw = "";
    setAgentModelForTests(
      agentScript([
        (o) => {
          saw = JSON.stringify(o.prompt);
          return { calls: [{ name: "buyer_reply", args: { ref: "o9" } }] };
        },
        { calls: [{ name: "buyer_reply", args: { ref: "o2" } }] },
        { text: "Ordered." },
      ]),
    );
    const r = await turn("laakso", { door: "typed", via: "typed", text: "the second one" });
    expect(saw).toContain("OPEN DECISIONS");
    expect(saw).toContain("o2: order option 2");
    expect(r.cards.some((c) => c.type === "gate")).toBe(true);
  });

  it("refuses a tap on a card that has moved on", async () => {
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "Options below." }]));
    const first = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    const options = first.cards.find((c) => c.type === "options");
    if (options?.type !== "options") throw new Error("no options");
    await turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId } });
    const again = await turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId } });
    expect(again.cards.find((c) => c.type === "notice")).toMatchObject({ kind: "refused" });
  });

  it("does not let the model call a tool that carries the buyer's answer or commits an order", async () => {
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] }, { text: "Options below." }]));
    const first = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    const options = first.cards.find((c) => c.type === "options");
    if (options?.type !== "options") throw new Error("no options");
    setAgentModelForTests(agentScript([{ calls: [{ name: "choose_option", args: { requestId: options.requestId, optionId: options.options[0].optionId, by: "agent" } }] }, { text: "Done." }]));
    const r = await turn("laakso", { door: "typed", via: "typed", text: "just pick one for me and order it" });
    expect(r.cards.some((c) => c.type === "gate" || c.type === "order")).toBe(false);
    const rt = await getRuntime();
    const s = await rt.dock.intake.get(await rt.dock.authenticate((await (await import("@/server/console-kitchens")).resolveKitchen("laakso"))!.mandateToken, "agent_laakso_buyer_01"), options.requestId);
    expect(s.state).toBe("options_ready");
  });
});

describe("the fallback model", () => {
  const answer = (id: string) =>
    new MockLanguageModelV4({
      provider: "p",
      modelId: id,
      doStream: async () => ({ stream: new ReadableStream({ start: (c) => (c.enqueue({ type: "stream-start", warnings: [] }), c.enqueue({ type: "text-start", id: "t" }), c.enqueue({ type: "text-delta", id: "t", delta: id }), c.enqueue({ type: "text-end", id: "t" }), c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }), c.close()) }) }),
    });
  const silent = new MockLanguageModelV4({ provider: "p", modelId: "silent", doStream: async () => ({ stream: new ReadableStream({ start: (c) => c.enqueue({ type: "stream-start", warnings: [] }) }) }) });

  async function textOf(m: ReturnType<typeof withFallback>) {
    const { stream } = await m.doStream({ prompt: [] } as unknown as LanguageModelV4CallOptions);
    const r = stream.getReader();
    let out = "";
    for (;;) {
      const { value, done } = await r.read();
      if (done) return out;
      if (value.type === "text-delta") out += value.delta;
    }
  }

  it("keeps a first model that answers in time", async () => {
    expect(await textOf(withFallback(answer("first"), answer("second"), { firstChunkMs: 200, totalMs: 600 }))).toBe("first");
  });

  it("asks the second model when the first stays silent", async () => {
    const seen: string[] = [];
    expect(await textOf(withFallback(silent, answer("second"), { firstChunkMs: 50, totalMs: 150, onFallback: (i) => seen.push(i.reason) }))).toBe("second");
    expect(seen[0]).toMatch(/no first token/);
  });
});

describe("the hedged reader", () => {
  const gen = (id: string, ms: number, calls: string[]) =>
    new MockLanguageModelV4({
      provider: "p",
      modelId: id,
      doGenerate: async (o) => {
        calls.push(id);
        await new Promise((r, j) => {
          const t = setTimeout(r, ms);
          o.abortSignal?.addEventListener("abort", () => (clearTimeout(t), j(new Error("aborted"))));
        });
        return { content: [{ type: "text", text: id }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
  const ask = async (m: ReturnType<typeof withFallback>) => ((await m.doGenerate({ prompt: [] } as unknown as LanguageModelV4CallOptions)).content[0] as { text: string }).text;

  it("asks the second model only when the first is slow, and takes the first answer", async () => {
    const calls: string[] = [];
    expect(await ask(withFallback(gen("fast", 10, calls), gen("second", 10, calls), { firstChunkMs: 100, totalMs: 1000, hedgeMs: 100 }))).toBe("fast");
    expect(calls).toEqual(["fast"]);
    const calls2: string[] = [];
    expect(await ask(withFallback(gen("slow", 400, calls2), gen("second", 10, calls2), { firstChunkMs: 50, totalMs: 1000, hedgeMs: 50 }))).toBe("second");
    expect(calls2).toEqual(["slow", "second"]);
  });
});

describe("the thread store", () => {
  it("replaces a card in place by its id and keeps counting after a reset", () => {
    const s = new ThreadStore();
    const t = s.get("k", "org");
    s.addTurn(t, { turnId: "a", role: "agent", at: "", replyTo: "b", status: "working", steps: [], cards: [] });
    s.card(t, "a", { type: "notice", cardId: "n", kind: "error", message: "one" });
    s.card(t, "a", { type: "notice", cardId: "n", kind: "error", message: "two" });
    expect(s.agentTurn(t, "a")!.cards).toHaveLength(1);
    expect(s.events("k", 0).map((e) => e.seq)).toEqual([1, 2, 3]);
    const fresh = s.reset("k", "org");
    expect(fresh.seq).toBe(4);
    expect(s.events("k", 0).map((e) => e.type)).toEqual(["reset"]);
  });
});

describe("words that pass on someone else's answer", () => {
  it("are relayed, whoever types them", async () => {
    const { passedOn } = await import("./pipeline");
    expect(passedOn("the chef said yes")).toBe(true);
    expect(passedOn("keittiömestari sanoi että käy")).toBe(true);
    expect(passedOn("kocken säger ja")).toBe(true);
    expect(passedOn("yes, 1000 is right")).toBe(false);
    expect(passedOn("our chef loves this milk")).toBe(false);
  });
});

describe("several items in one message", () => {
  it("are split where a new amount starts, the day given to each", async () => {
    const { splitItems } = await import("./pipeline");
    expect(splitItems("30 litres of lactose-free milk and 6 litres of lactose-free cream for Thursday")).toEqual(["30 litres of lactose-free milk for Thursday", "6 litres of lactose-free cream for Thursday"]);
    expect(splitItems("20 kg voita ja 10 litraa kermaa torstaiksi")).toEqual(["20 kg voita torstaiksi", "10 litraa kermaa torstaiksi"]);
    expect(splitItems("100 litres of milk for Thursday")).toEqual([]);
    expect(splitItems("milk and cream")).toEqual([]);
  });
});

describe("when the day's model cap is reached", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
    process.env.DOCK_LLM = "off";
  });
  afterEach(() => {
    delete process.env.DOCK_LLM;
    delete process.env.DOCK_MEMORY;
  });

  it("says the reading is paused, and an earlier order is ordered again with one tap and no model", async () => {
    const r = await turn("kaari", { door: "typed", via: "typed", text: "100 litres of lactose-free milk for Thursday" });
    expect(r.cards.find((c) => c.type === "notice")).toMatchObject({ kind: "paused" });
    const records = r.cards.find((c) => c.type === "records");
    if (records?.type !== "records") throw new Error("no repeatable orders");
    expect(records.repeatable).toBe(true);
    const ref = records.rows.find((x) => x.ref)!.ref!;
    const again = await turn("kaari", { door: "typed", via: "tap", action: { type: "repeat", ref }, label: "Order this again" });
    expect(again.cards.some((c) => c.type === "understood")).toBe(true);
    expect(again.cards.some((c) => c.type === "options" || c.type === "anomaly" || c.type === "question" || c.type === "gate" || c.type === "notice")).toBe(true);
    const rt = await getRuntime();
    expect(rt.dock.ledger.entries().some((e) => e.type === "agent" && (e.data as { event?: string }).event === "model_call")).toBe(false);
  });
});

describe("a second request after a sign-off", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
  });
  afterEach(() => {
    setAgentModelForTests(undefined);
    setInterpretModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
  });

  it("is answered: the paused sign-off step leaves no tool call without its result in the history", async () => {
    setInterpretModelForTests(reader(1000));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "1000 litres of lactose-free milk for Monday" } }] }, { text: "Options below." }]));
    const first = await turn("laakso", { door: "typed", via: "typed", text: "1000 litres of lactose-free milk for Monday" });
    let options = first.cards.find((c) => c.type === "options");
    if (!options) {
      const a = first.cards.find((c) => c.type === "anomaly");
      if (a?.type !== "anomaly") throw new Error("neither options nor a check");
      const r = await turn("laakso", { door: "typed", via: "tap", action: { type: "concern", requestId: a.requestId, key: a.concerns[0].key, choice: "confirm" } });
      options = r.cards.find((c) => c.type === "options");
    }
    if (options?.type !== "options") throw new Error("no options");
    // The tap sends it for an OK; the engine has the agent pause on await_sign_off.
    const placedTurn = turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId } });
    setAgentModelForTests(
      agentScript([
        (o) => {
          const m = JSON.stringify(o.prompt).match(/ord_[a-z0-9]+/);
          return { text: "Waiting for the OK.", calls: m ? [{ name: "await_sign_off", args: { orderId: m[0] } }] : [] };
        },
        { text: "Signed and placed." },
        { text: "Signed and placed." },
      ]),
    );
    const placed = await placedTurn;
    const gate = placed.cards.find((c) => c.type === "gate");
    expect(gate?.type === "gate" && gate.outcome).toBe("waiting");
    const rt = await getRuntime();
    const m = rt.outbox.messages().at(-1)!;
    const token = /[?&]token=([^&]+)/.exec(m.link)![1];
    await rt.dock.decideApproval(m.approvalId, { decision: "approve", proof: { kind: "link_token", token: decodeURIComponent(token) } });
    await new Promise((r) => setTimeout(r, 300));
    // The next request: the provider would refuse a history with an unanswered tool call.
    let sent = "";
    setInterpretModelForTests(reader(20));
    setAgentModelForTests(
      agentScript([
        (o) => {
          sent = JSON.stringify(o.prompt);
          return { calls: [{ name: "order", args: { words: "20 litres of lactose-free milk for Monday" } }] };
        },
        { text: "Options below." },
      ]),
    );
    const second = await turn("laakso", { door: "typed", via: "typed", text: "20 litres of lactose-free milk for Monday" });
    expect(second.cards.find((c) => c.type === "notice" && c.kind === "unavailable")).toBeUndefined();
    expect(second.cards.some((c) => c.type === "understood")).toBe(true);
    // Every tool call in what the model was sent has its result.
    const calls = [...sent.matchAll(/"type":"tool-call","toolCallId":"([^"]+)"/g)].map((x) => x[1]);
    for (const id of calls) expect(sent).toContain(`"toolCallId":"${id}","toolName"`);
  });
});

describe("history sent with a new turn", () => {
  it("has a result for every tool call and no leftover approval parts", async () => {
    const { settled } = await import("./engine");
    const out = settled([
      { role: "user", content: "x" },
      { role: "assistant", content: [{ type: "text", text: "Waiting." }, { type: "tool-call", toolCallId: "c1", toolName: "await_sign_off", input: { orderId: "o" } }, { type: "tool-approval-request", approvalId: "a1", toolCallId: "c1" }] },
      { role: "user", content: "next" },
    ] as never);
    expect(JSON.stringify(out)).not.toContain("tool-approval");
    expect(out[2]).toMatchObject({ role: "tool", content: [{ type: "tool-result", toolCallId: "c1" }] });
  });
});
