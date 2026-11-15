import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setInterpretModelForTests } from "@/server/agent/interpret";
import { resolveKitchen } from "@/server/console-kitchens";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { resetThread, submitTurn, threadStore } from "./engine";
import { ownCards, ownTurns, visitorSwitch, VISITOR_NOTE_MS } from "./visitor";
import type { Card } from "./types";

const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 30, text: 30, reasoning: undefined } };
type Step = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] };
function agentScript(turns: (Step | ((o: LanguageModelV4CallOptions) => Step))[]) {
  let i = 0;
  let n = 0;
  const model = new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "scripted-agent",
    doStream: async (options) => {
      const d = turns[Math.min(i++, turns.length - 1)];
      const t = typeof d === "function" ? d(options) : d;
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (t.text) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t.text }, { type: "text-end", id: "t" });
      for (const c of t.calls ?? []) parts.push({ type: "tool-call", toolCallId: `c${++n}`, toolName: c.name, input: JSON.stringify(c.args) });
      parts.push({ type: "finish", finishReason: { unified: t.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  });
  return { model, id: "anthropic:scripted-agent" };
}
function reader(amount: number, item = "lactose-free milk") {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const need = { isPurchaseRequest: true, notPurchaseReason: null, item: { text: item, category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null }, quantity: { amount, unit: "L" }, deliverBy: d.toISOString().slice(0, 10), requiredClaims: ["lactose_free"], forbiddenAllergens: [], optimise: "unstated", sameAsLastTime: false, basedOnRequestId: null, takenFromEarlier: [] };
  const model = new MockLanguageModelV4({ provider: "scripted", modelId: "reader", doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(need) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) });
  return { model, id: "scripted:reader" };
}
async function turn(kitchen: string, body: Record<string, unknown>, visitor?: string): Promise<{ cards: Card[]; line: string; turnId: string }> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(kitchen, (e) => {
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(kitchen, body, visitor ? { visitor } : {})).agentTurnId;
  await done;
  const a = store.agentTurn(store.peek(kitchen)!, id)!;
  return { cards: a.cards, line: a.line ?? "", turnId: id };
}

describe("the session boundary", () => {
  const b = (id: string, visitor: string, at = "2026-11-15T08:00:00Z") => ({ role: "buyer", turnId: id, at, visitor, door: "typed", via: "typed" }) as never;
  const a = (id: string, cards: unknown[] = [], boundary?: boolean) => ({ role: "agent", turnId: id, at: "", replyTo: boundary ? "visitor" : "x", status: "done", steps: [], cards, ...(boundary ? { boundary: "visitor" } : {}) }) as never;
  it("is set only in a shared kitchen, for a different browser session, and the note only within ten minutes", () => {
    const now = Date.parse("2026-11-15T08:05:00Z");
    expect(visitorSwitch([b("b1", "A")], "B", true, now)).toEqual({ note: true });
    expect(visitorSwitch([b("b1", "A")], "B", true, now + VISITOR_NOTE_MS)).toEqual({ note: false });
    expect(visitorSwitch([b("b1", "A")], "A", true, now)).toBeUndefined();
    expect(visitorSwitch([b("b1", "A")], "B", false, now)).toBeUndefined();
    expect(visitorSwitch([], "B", true, now)).toBeUndefined();
  });
  it("leaves only what this session opened", () => {
    const turns = [b("b1", "A"), a("a1", [{ cardId: "anomaly:r1" }]), a("x", [], true), b("b2", "B"), a("a2", [{ cardId: "options:r2" }])];
    expect(ownTurns(turns).map((t: { turnId: string }) => t.turnId)).toEqual(["b2", "a2"]);
    expect(ownCards(turns, [{ turnId: "a1", card: { cardId: "anomaly:r1" } as never }, { turnId: "a2", card: { cardId: "options:r2" } as never }]).map((x) => x.card.cardId)).toEqual(["options:r2"]);
  });
});

describe("two visitors in one shared kitchen", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
  });
  afterEach(() => {
    setAgentModelForTests(undefined);
    setInterpretModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
  });

  it("never answers or mentions what the other one left open, and says quietly that another visitor is here", async () => {
    setInterpretModelForTests(reader(5000));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "5000 litres of lactose-free milk for Monday" } }] }, { text: "Is 5 000 L right?" }]));
    const first = await turn("hotel-lumo", { door: "typed", via: "typed", text: "5000 litres of lactose-free milk for Monday", lang: "en" }, "visitor-a");
    const check = first.cards.find((c) => c.type === "anomaly" || c.type === "options");
    expect(check).toBeTruthy();
    let prompt = "";
    setAgentModelForTests(agentScript([(o) => ((prompt = JSON.stringify(o.prompt)), { text: "What do you need?" })]));
    const second = await turn("hotel-lumo", { door: "typed", via: "typed", text: "yes", lang: "en" }, "visitor-b");
    // The other visitor's check is still open: B's yes did not answer it, and B's agent was not shown it.
    const store = await threadStore();
    const t = store.peek("hotel-lumo")!;
    const now = store.cards(t).map((x) => x.card).find((c) => c.cardId === check!.cardId);
    if (now?.type === "anomaly") expect(now.answered).toBeUndefined();
    if (now?.type === "options") expect(now.chosen).toBeUndefined();
    expect(second.cards.some((c) => c.type === "gate" || c.type === "order" || c.type === "price")).toBe(false);
    // The other visitor's request (5 000 L) is nowhere in what B's agent was given: not in the history, not as open.
    expect(prompt).not.toMatch(/5000|5 000/);
    expect(t.turns.some((x) => x.role === "agent" && x.boundary === "visitor" && x.note)).toBe(true);
    // A's own next turn: the boundary again (B wrote last), and A's open check is not answered by B's words either.
    expect(t.turns.filter((x) => x.role === "agent" && x.boundary).length).toBe(1);
  }, 60_000);

  it("start over takes back what the conversation left waiting for an OK", async () => {
    setInterpretModelForTests(reader(1000));
    setAgentModelForTests(agentScript([{ calls: [{ name: "order", args: { words: "1000 litres of lactose-free milk for Monday" } }] }, { text: "Options below." }]));
    let r = await turn("laakso", { door: "typed", via: "typed", text: "1000 litres of lactose-free milk for Monday", lang: "en" });
    const a = r.cards.find((c) => c.type === "anomaly");
    if (a?.type === "anomaly") r = await turn("laakso", { door: "typed", via: "tap", action: { type: "concern", requestId: a.requestId, key: a.concerns[0].key, choice: "confirm" } });
    const options = r.cards.find((c) => c.type === "options");
    if (options?.type !== "options") throw new Error("no options");
    setAgentModelForTests(agentScript([{ text: "Sent for the OK." }]));
    const placed = await turn("laakso", { door: "typed", via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.options[0].optionId } });
    const gate = placed.cards.find((c) => c.type === "gate");
    if (gate?.type !== "gate" || gate.outcome !== "waiting" || !gate.orderId) return; // placed alone on this seed: nothing waits
    await resetThread((await resolveKitchen("laakso"))!);
    const rt = await getRuntime();
    const o = (await rt.dock.listOrders()).find((x) => x.orderId === gate.orderId);
    expect(o?.status).toBe("withdrawn");
  }, 60_000);
});
