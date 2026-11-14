import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { submitTurn, threadStore } from "./engine";
import type { Card, PlanCard } from "./types";

const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 30, text: 30, reasoning: undefined } };

/** The agent's model, scripted: each step is the next turn. */
function agentScript(turns: { text?: string; calls?: { name: string; args: Record<string, unknown> }[] }[]) {
  let i = 0;
  let n = 0;
  const model = new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "scripted-agent",
    doStream: async () => {
      const t = turns[Math.min(i++, turns.length - 1)];
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (t.text) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t.text }, { type: "text-end", id: "t" });
      for (const c of t.calls ?? []) parts.push({ type: "tool-call", toolCallId: `c${++n}`, toolName: c.name, input: JSON.stringify(c.args) });
      parts.push({ type: "finish", finishReason: { unified: t.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  });
  return { model, id: "anthropic:scripted-agent" };
}

async function turn(kitchen: string, body: Record<string, unknown>): Promise<{ cards: Card[]; status: string }> {
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
  id = (await submitTurn(kitchen, body)).agentTurnId;
  await done;
  const a = store.agentTurn(store.peek(kitchen)!, id)!;
  return { cards: a.cards, status: a.status };
}

const WORDS = "Salmon soup for 300 on Friday"; // a recorded planner draft (server/agent/menu/eval/recorded)

describe("a recipe request in the thread", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
    process.env.DOCK_RATE_LIMITS = "off";
    process.env.DOCK_MENU_MODEL = "recorded";
  });
  afterEach(() => {
    setAgentModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
    delete process.env.DOCK_MENU_MODEL;
  });

  it("runs the menu planner as a tool and shows its plan as one card, then one confirmation orders it through the gate", async () => {
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "The plan is below; one tap orders it." }]));
    const first = await turn("kaari", { door: "typed", via: "typed", text: WORDS });
    const plan = first.cards.find((c): c is PlanCard => c.type === "plan");
    expect(plan).toBeTruthy();
    expect(plan!.dishes.length).toBeGreaterThan(0);
    expect(plan!.covers).toBe(300);
    expect(plan!.lines.length).toBeGreaterThan(0);
    // Plain words only: no product ids or codes in the rows.
    for (const l of plan!.lines) expect(`${l.product ?? ""} ${l.point?.text ?? ""}`).not.toMatch(/\b(VA|AR|PK)-\d{4}\b|searched:/);
    expect(plan!.editUrl).toBe(`/k/kaari/menu?plan=${plan!.planId}`);
    if (!plan!.canOrder) {
      expect(plan!.blockers.length + plan!.lines.filter((l) => l.status === "left_out").length).toBeGreaterThan(0);
      return;
    }
    expect(first.status).toBe("waiting_buyer");
    const second = await turn("kaari", { door: "typed", via: "tap", action: { type: "plan_order", planId: plan!.planId }, label: "Order this plan" });
    const gate = second.cards.find((c) => c.type === "gate");
    expect(gate).toBeTruthy();
    expect(second.cards.some((c) => c.type === "order")).toBe(true);
    const updated = (await threadStore()).cards((await threadStore()).peek("kaari")!).find((x) => x.card.type === "plan" && x.card.planId === plan!.planId)!.card as PlanCard;
    expect(updated.state).toBe("ordered");
    // A second tap on the same plan is refused: the card has moved on.
    const again = await turn("kaari", { door: "typed", via: "tap", action: { type: "plan_order", planId: plan!.planId } });
    expect(again.cards.find((c) => c.type === "notice")).toMatchObject({ kind: "refused" });
  });

  it("puts the planner's model calls and the plan in the conversation's record", async () => {
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "Plan below." }]));
    await turn("kaari", { door: "typed", via: "typed", text: WORDS });
    const { dock } = await getRuntime();
    const own = dock.ledger.entries().filter((e) => e.type === "agent" && (e.data as { event?: string }).event === "plan");
    expect(own.length).toBe(1);
    expect((own[0].data as { thread?: { threadId?: string } }).thread?.threadId).toBeTruthy();
  });
});
