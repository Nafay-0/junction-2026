import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmMenuDraft } from "@/server/agent/menu/draft";
import { setMenuModelForTests } from "@/server/agent/menu/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { setAgentModelForTests } from "./agent";
import { submitTurn, threadStore } from "./engine";
import type { Card, MenuCard, SheetCard, ThreadEvent } from "./types";

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

type Raw = LlmMenuDraft;
type Dish = Raw["dishes"][number];

/**
 * The menu planner's model, scripted: the outline call answers with the dishes (and `alternatives`), each dish call
 * with that dish's ingredients. `delayMs` keeps the dish calls behind the outline, as a real model is.
 */
function plannerScript(menus: { when?: RegExp; raw: Raw; alternatives?: { title: string; dishes: string[] }[] }[], delayMs = 30) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (o) => {
      const text = JSON.stringify(o.prompt);
      prompts.push(text);
      const menu = menus.find((m) => !m.when || m.when.test(text)) ?? menus[0];
      let body: unknown;
      if (text.includes("ONE dish")) {
        await new Promise((r) => setTimeout(r, delayMs));
        const d = menu.raw.dishes.find((x) => text.includes(`The dish: ${x.name}`)) ?? menu.raw.dishes[0];
        body = { ingredients: d.ingredients, conflicts: [] };
      } else body = { ...menu.raw, dishes: menu.raw.dishes.map(({ ingredients: _i, ...d }) => (void _i, d)), alternatives: menu.alternatives ?? [] };
      return { content: [{ type: "text", text: JSON.stringify(body) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, id: "mock:planner", prompts };
}

async function turn(kitchen: string, body: Record<string, unknown>, events?: ThreadEvent[]): Promise<{ cards: Card[]; status: string; turnId: string }> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(kitchen, (e) => {
      events?.push(structuredClone(e));
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(kitchen, body)).agentTurnId;
  await done;
  const a = store.agentTurn(store.peek(kitchen)!, id)!;
  return { cards: a.cards, status: a.status, turnId: id };
}

async function menuNow(kitchen: string, planId?: string): Promise<MenuCard> {
  const store = await threadStore();
  const all = store.cards(store.peek(kitchen)!).map((x) => x.card).filter((c): c is MenuCard => c.type === "menu");
  return (planId ? all.find((c) => c.planId === planId) : all.at(-1))!;
}

type Ing = Dish["ingredients"][number];
const ing = (key: string, name: string, searchTerms: string[], amount: number, unit: "g" | "ml" | "pcs", over: Partial<Ing> = {}): Ing => ({ key, name, searchTerms, role: "in the dish", perCover: { amount, unit }, yieldPct: 100, amountBasis: "a normal portion", pantry: false, form: "any", avoid: [], ...over });
const dish = (name: string, course: Dish["course"], ingredients: Ing[]): Dish => ({ name, nameFi: null, course, serviceDate: null, portion: "one portion", method: "Made in the kitchen.", ingredients });
/** A menu the test runtime's assortment (dairy) can buy: what the scripted planner model writes. */
const DAIRY: Raw = {
  isFoodOrderRequest: true,
  declineReason: null,
  covers: 300,
  serviceDate: null,
  occasion: "Dessert and drink",
  requiredClaims: [],
  forbiddenAllergens: [],
  assumptions: [],
  conflicts: [],
  dishes: [
    dish("Lactose-free panna cotta", "dessert", [
      ing("cream_lactose_free", "Lactose-free whipping cream", ["laktoositon kerma", "lactose-free whipping cream"], 80, "ml"),
      ing("milk_lactose_free", "Lactose-free milk", ["laktoositon maito", "lactose-free milk"], 40, "ml"),
      ing("salt", "Salt", ["suola", "salt"], 1, "g", { pantry: true }),
    ]),
    dish("Yoghurt and oat smoothie", "drink", [
      ing("yoghurt_lactose_free", "Lactose-free natural yoghurt", ["laktoositon jogurtti", "lactose-free natural yoghurt"], 100, "g"),
      ing("oat_drink", "Oat drink", ["kaurajuoma", "oat drink"], 80, "ml"),
    ]),
  ],
};
const WORDS = "Panna cotta and a smoothie for 300";
const lines = (c: MenuCard) => c.dishes.flatMap((d) => d.lines);

describe("the menu builder in the thread", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
    process.env.DOCK_RATE_LIMITS = "off";
    process.env.DOCK_MENU_MODEL = "recorded";
  });
  afterEach(() => {
    setAgentModelForTests(undefined);
    setMenuModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
    delete process.env.DOCK_MENU_MODEL;
  });

  it("streams: the dishes first, then each dish's lines resolving, then products and prices, then ready", async () => {
    const planner = plannerScript([{ raw: DAIRY }]);
    setMenuModelForTests(planner);
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "The menu is below." }]));
    const events: ThreadEvent[] = [];
    const t = await turn("kaari", { door: "typed", via: "typed", text: WORDS }, events);
    const seen = events.flatMap((e) => (e.type === "card" && e.card.type === "menu" ? [e.card] : []));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // 1. The outline: the dishes, no lines yet.
    expect(seen[0].stage).toBe("proposing");
    expect(seen[0].dishes.map((d) => d.name)).toEqual(DAIRY.dishes.map((d) => d.name));
    expect(lines(seen[0])).toHaveLength(0);
    // 2. The dish written: its lines, still resolving, with the amount per cover and what 300 covers need.
    const written = seen.find((c) => lines(c).length > 0)!;
    expect(written.stage).toBe("proposing");
    expect(lines(written).filter((l) => l.status !== "have").every((l) => l.status === "resolving" && !l.product)).toBe(true);
    const cream = lines(written).find((l) => /cream/i.test(l.ingredient))!;
    expect(cream.perCover).toEqual({ amount: 80, unit: "ml" });
    expect(cream.need).toEqual({ amount: 24, unit: "L" }); // 80 ml × 300 covers
    // 3. Ready: products, packs, prices, cost per cover, the gate's preview of the plan as one order.
    const last = seen.at(-1)!;
    expect(last.stage).toBe("ready");
    expect(seen.findIndex((c) => c.stage === "ready")).toBeGreaterThan(seen.indexOf(written));
    const bought = lines(last).filter((l) => l.product);
    expect(bought.length).toBeGreaterThanOrEqual(3);
    expect(last.totalCents).toBe(bought.reduce((s, l) => s + l.product!.totalCents, 0));
    expect(last.costPerCoverCents).toBe(Math.round(last.totalCents / 300));
    expect(last.gate?.outcome).toMatch(/auto_approve|needs_human_approval|reject/);
    expect(last.days.length).toBeGreaterThan(0);
    // Plain words only: no product codes, no search log.
    for (const l of lines(last)) for (const c of l.conflicts) expect(c.text).not.toMatch(/searched:/);
    expect(t.status).toBe("waiting_buyer");
    // The planner's calls: one outline, then the dishes (the planner model, not the agent's).
    expect(planner.prompts.filter((p) => p.includes("ONE dish"))).toHaveLength(DAIRY.dishes.length);
    // The conversation's record: when the dishes and the ready plan were on screen, and the planner's own timings.
    const { dock } = await getRuntime();
    const rec = dock.ledger.entries().filter((e) => e.type === "agent" && (e.data as { event?: string }).event === "menu");
    expect(rec).toHaveLength(1);
    const data = rec[0].data as { thread?: { threadId?: string }; shown: { outlineMs: number; readyMs: number }; planner: { calls: unknown[] } };
    expect(data.thread?.threadId).toBeTruthy();
    expect(data.shown.outlineMs).toBeLessThanOrEqual(data.shown.readyMs);
    expect(data.planner.calls.length).toBe(1 + DAIRY.dishes.length);
  });

  it("open words get menus to choose from; the first plans behind the card, another is planned with its dishes fixed", async () => {
    const BEET: Raw = { ...DAIRY, occasion: "Beetroot lunch", covers: 40, dishes: [{ ...DAIRY.dishes[0], name: "Beetroot panna cotta" }] };
    const OTHER: Raw = { ...DAIRY, occasion: "Beetroot risotto", covers: 40, dishes: [{ ...DAIRY.dishes[1], name: "Beetroot risotto" }] };
    const planner = plannerScript([
      { when: /Cook exactly these dishes/, raw: OTHER },
      { raw: BEET, alternatives: [{ title: "Beetroot risotto", dishes: ["Beetroot risotto"] }, { title: "Borscht", dishes: ["Borscht", "Rye bread"] }] },
    ]);
    setMenuModelForTests(planner);
    const words = "Plan lunch for 40 around beetroot";
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words } }] }, { text: "Three menus below; pick one." }]));
    const first = await turn("kaari", { door: "typed", via: "typed", text: words });
    const card = first.cards.find((c): c is MenuCard => c.type === "menu")!;
    expect(card.stage).toBe("choose");
    expect(card.proposals.map((p) => p.title)).toEqual(["Beetroot lunch", "Beetroot risotto", "Borscht"]);
    expect(first.status).toBe("waiting_buyer");
    // The buyer picks the second: planned again with those dishes, into the same card.
    const second = await turn("kaari", { door: "typed", via: "tap", action: { type: "menu_choose", planId: card.planId, proposalId: "p2" }, label: "Beetroot risotto" });
    expect(second.cards.find((c) => c.type === "notice")).toBeUndefined();
    const now = await menuNow("kaari");
    expect(now.cardId).toBe(card.cardId);
    expect(now.stage).toBe("ready");
    expect(now.dishes.map((d) => d.name)).toEqual(["Beetroot risotto"]);
    expect(planner.prompts.some((p) => p.includes("Cook exactly these dishes (Beetroot risotto): Beetroot risotto"))).toBe(true);
    // The first proposal's plan, still running behind, no longer touches the card.
    await new Promise((r) => setTimeout(r, 150));
    expect((await menuNow("kaari")).dishes.map((d) => d.name)).toEqual(["Beetroot risotto"]);
  });

  it("choosing the first menu takes the plan already made behind the card", async () => {
    const planner = plannerScript([{ raw: DAIRY, alternatives: [{ title: "Rice pudding", dishes: ["Rice pudding"] }] }]);
    setMenuModelForTests(planner);
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: "Something with salmon for 300 on Friday" } }] }, { text: "Two menus below." }]));
    const first = await turn("kaari", { door: "typed", via: "typed", text: "Something with salmon for 300 on Friday" });
    const card = first.cards.find((c): c is MenuCard => c.type === "menu")!;
    expect(card.stage).toBe("choose");
    const outlines = planner.prompts.filter((p) => !p.includes("ONE dish")).length;
    await turn("kaari", { door: "typed", via: "tap", action: { type: "menu_choose", planId: card.planId, proposalId: "p1" } });
    const now = await menuNow("kaari");
    expect(now.stage).toBe("ready");
    expect(now.planId).toBe(card.planId);
    expect(planner.prompts.filter((p) => !p.includes("ONE dish")).length).toBe(outlines); // nothing drafted again
  });

  describe("editing in place", () => {
    async function ready(): Promise<MenuCard> {
      setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "Below." }]));
      const t = await turn("kaari", { door: "typed", via: "typed", text: WORDS });
      const c = t.cards.find((x): x is MenuCard => x.type === "menu")!;
      expect(c.stage).toBe("ready");
      return c;
    }
    const tap = (action: Record<string, unknown>) => turn("kaari", { door: "typed", via: "tap", action });
    beforeEach(() => setMenuModelForTests(plannerScript([{ raw: DAIRY }])));

    it("covers: every amount and the cost per cover follow", async () => {
      const c = await ready();
      const before = lines(c).find((l) => l.product)!;
      await tap({ type: "menu_covers", planId: c.planId, covers: 150 });
      const now = await menuNow("kaari", c.planId);
      expect(now.covers).toBe(150);
      const after = lines(now).find((l) => l.lineId === before.lineId)!;
      expect(after.need.amount).toBeCloseTo(before.need.amount / 2, 2);
      expect(now.totalCents).toBeLessThan(c.totalCents);
    });

    it("day: the plan moves to another delivery day", async () => {
      const c = await ready();
      const day = c.days.find((d) => d.available && d.date !== c.serviceDate)!;
      await tap({ type: "menu_day", planId: c.planId, date: day.date });
      expect((await menuNow("kaari", c.planId)).serviceDate).toBe(day.date);
    });

    it("have: a line the kitchen has is struck and costs nothing; undone, it is bought again", async () => {
      const c = await ready();
      const l = lines(c).find((x) => x.product)!;
      await tap({ type: "menu_line_have", planId: c.planId, lineId: l.lineId, have: true });
      let now = await menuNow("kaari", c.planId);
      expect(lines(now).find((x) => x.lineId === l.lineId)!.status).toBe("have");
      expect(now.totalCents).toBe(c.totalCents - l.product!.totalCents);
      await tap({ type: "menu_line_have", planId: c.planId, lineId: l.lineId, have: false });
      now = await menuNow("kaari", c.planId);
      expect(lines(now).find((x) => x.lineId === l.lineId)!.product).toBeTruthy();
    });

    it("per cover: one line's amount changes, the others stay", async () => {
      const c = await ready();
      const l = lines(c).find((x) => x.product && x.perCover.unit === "g")!;
      const dishId = c.dishes.find((d) => d.lines.some((x) => x.lineId === l.lineId))!.dishId;
      await tap({ type: "menu_line_per_cover", planId: c.planId, lineId: l.lineId, dishId, amount: l.perCover.amount * 2 });
      const now = await menuNow("kaari", c.planId);
      const after = lines(now).find((x) => x.lineId === l.lineId)!;
      expect(after.perCover.amount).toBe(l.perCover.amount * 2);
      expect(after.need.amount).toBeCloseTo(l.need.amount * 2, 2);
    });

    it("swap: only the planner's own options, each one the gate would take", async () => {
      const c = await ready();
      const l = lines(c).find((x) => x.options.some((o) => !o.optionId.startsWith("fix:")));
      expect(l).toBeTruthy(); // lactose-free milk: several products priced
      const o = l!.options.find((x) => !x.optionId.startsWith("fix:"))!;
      await tap({ type: "menu_line_swap", planId: c.planId, lineId: l!.lineId, optionId: o.optionId });
      const now = await menuNow("kaari", c.planId);
      expect(lines(now).find((x) => x.lineId === l!.lineId)!.product!.name).toBe(o.name);
      expect(now.gate?.outcome).not.toBe("reject");
    });

    it("accept: an unusual amount is accepted on its line and the line is ready", async () => {
      // A dish with an amount beyond what one cover can use: the planner holds it until a person says it is right.
      const big: Raw = { ...DAIRY, dishes: DAIRY.dishes.map((d: Dish, n) => (n === 1 ? { ...d, ingredients: d.ingredients.map((i, m) => (m === 0 ? { ...i, perCover: { amount: 650, unit: "g" as const } } : i)) } : d)) };
      setMenuModelForTests(plannerScript([{ raw: big }]));
      const c = await ready();
      const l = lines(c).find((x) => x.conflicts.some((k) => k.code === "amount_check" && k.doubtId))!;
      expect(l.status).toBe("decide");
      const k = l.conflicts.find((x) => x.doubtId)!;
      expect(k.blocking).toBe(false);
      await tap({ type: "menu_accept", planId: c.planId, doubtId: k.doubtId });
      const now = await menuNow("kaari", c.planId);
      expect(lines(now).find((x) => x.lineId === l.lineId)!.conflicts.some((x) => x.doubtId === k.doubtId)).toBe(false);
    });
  });

  it("to the sheet: every bought line on one order sheet, placed as one order through the gate", async () => {
    setMenuModelForTests(plannerScript([{ raw: DAIRY }]));
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "Below." }]));
    const t = await turn("kaari", { door: "typed", via: "typed", text: WORDS });
    const c = t.cards.find((x): x is MenuCard => x.type === "menu")!;
    const bought = lines(c).filter((l) => l.product && !l.conflicts.some((k) => k.blocking));
    setAgentModelForTests(agentScript([{ text: "The sheet is below." }]));
    const s = await turn("kaari", { door: "typed", via: "tap", action: { type: "menu_to_sheet", planId: c.planId }, label: "Put on the order sheet" });
    const sheet = s.cards.find((x): x is SheetCard => x.type === "sheet")!;
    expect(sheet).toBeTruthy();
    expect(new Set(sheet.lines.map((l) => l.productId))).toEqual(new Set(bought.map((l) => l.product!.productId)));
    expect((await menuNow("kaari", c.planId)).sheetId).toBe(sheet.sheetId);
    // The menu is now on the sheet: edits go there.
    const late = await turn("kaari", { door: "typed", via: "tap", action: { type: "menu_covers", planId: c.planId, covers: 10 } });
    expect(late.cards.find((x) => x.type === "notice")).toMatchObject({ kind: "refused" });
    const { dock } = await getRuntime();
    const ordersBefore = (await dock.listOrders()).length;
    const placed = await turn("kaari", { door: "typed", via: "tap", action: { type: "sheet_place", sheetId: sheet.sheetId, version: sheet.version } });
    expect(placed.cards.some((x) => x.type === "gate")).toBe(true);
    const orders = await dock.listOrders();
    expect(orders.length).toBe(ordersBefore + 1);
    // Under the menu agent's mandate (food of every kind), the one the plan was made and previewed by.
    expect(orders.at(-1)!.agentId).toMatch(/menu/);
  });

  it("a line that breaks a stated rule is shown as a conflict on the line and is not ordered", async () => {
    // Kaari's head chef: dairy must be lactose-free. The chef asks for ordinary milk in the smoothie.
    const asked: Raw = {
      ...DAIRY,
      conflicts: ["Kitchen rule: dairy must be lactose-free, but the chef asked for ordinary milk in the smoothie."],
      dishes: [DAIRY.dishes[0], { ...DAIRY.dishes[1], ingredients: [...DAIRY.dishes[1].ingredients, ing("ordinary_milk", "Ordinary milk", ["maito", "semi-skimmed milk"], 50, "ml", { avoid: ["laktoositon", "lactose-free", "eila", "kaura", "oat"] })] }],
    };
    setMenuModelForTests(plannerScript([{ raw: asked }]));
    setAgentModelForTests(agentScript([{ calls: [{ name: "plan_menu", args: { words: WORDS } }] }, { text: "Below." }]));
    const t = await turn("kaari", { door: "typed", via: "typed", text: WORDS });
    const c = t.cards.find((x): x is MenuCard => x.type === "menu")!;
    const milk = lines(c).find((l) => l.lineId === "ordinary_milk")!;
    expect(milk.status).toBe("decide");
    expect(milk.product).toBeUndefined();
    expect(milk.conflicts.find((k) => k.blocking)!.code).toMatch(/rule_conflict|no_safe_product/);
    expect(milk.conflicts.find((k) => k.blocking)!.text).toMatch(/lactose-free/);
    expect(milk.options).toHaveLength(0); // nothing offered that breaks the rule
    const s = await turn("kaari", { door: "typed", via: "tap", action: { type: "menu_to_sheet", planId: c.planId } });
    const sheet = s.cards.find((x): x is SheetCard => x.type === "sheet")!;
    expect(sheet.lines.length).toBeGreaterThan(0);
    for (const l of sheet.lines) expect(l.name).toMatch(/lactose-free|oat/i);
    const { dock } = await getRuntime();
    const left = dock.ledger.entries().find((e) => e.type === "agent" && (e.data as { event?: string }).event === "menu_to_sheet");
    expect(left?.summary).toMatch(/left off: Ordinary milk/);
  });
});
