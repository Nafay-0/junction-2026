import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localNow } from "@/core/kitchen";
import { resolveKitchen } from "@/server/console-kitchens";
import { standing, type Kitchen } from "@/server/kitchen-portal";
import { getMemoryService, resetMemoryService } from "@/server/memory/runtime";
import { radarStore } from "@/server/radar/store";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { openToday, submitTurn, threadStore } from "./engine";
import type { Card, SheetCard, TodayCard } from "./types";

/**
 * The agent as the kitchen's home (docs/agent-thread.md "The home"): the day's opening card is made by plain code from
 * records only, and every way to buy from it (a grid's add, order again, a recurring order changed) lands on the order
 * sheet, never straight at the gate. Memory changes are the signed-in person's, recorded as theirs.
 */

async function kitchen(slug: string, person?: string): Promise<Kitchen> {
  const k = (await resolveKitchen(slug))!;
  return { ...k, console: { kitchen: slug, session: `test-${slug}`, ...(person ? { person: { channel: "portal_session" as const, name: person } } : {}) } } as Kitchen;
}

/** One tap through the engine, waited for until its agent turn is no longer working. */
async function tap(k: Kitchen, action: Record<string, unknown>, label = "tap"): Promise<Card[]> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(k.info.slug, (e) => {
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(k, { door: "typed", via: "tap", action, label })).agentTurnId;
  await done;
  return store.agentTurn(store.peek(k.info.slug)!, id)!.cards;
}

async function opening(k: Kitchen): Promise<TodayCard> {
  const store = await threadStore();
  const id = await openToday(k);
  expect(id).toBeTruthy();
  for (let i = 0; i < 200; i++) {
    const a = store.agentTurn(store.peek(k.info.slug)!, id!)!;
    if (a.status !== "working") return a.cards.find((c) => c.type === "today") as TodayCard;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the opening never finished");
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_LIVE = "off";
});
afterEach(() => {
  delete process.env.DOCK_MEMORY_LLM;
  delete process.env.DOCK_LIVE;
});

describe("the day's opening", () => {
  it("lists only what the records hold, and is posted once a day", async () => {
    const k = await kitchen("kaari");
    const rt = await getRuntime();
    const card = await opening(k);
    expect(card.pending).toBeUndefined();
    expect(card.date).toBe(localNow(new Date()).date);

    const orders = (await rt.dock.listOrders()).filter((o) => o.orgId === k.info.orgId);
    const profile = await rt.kitchens.getProfile(k.info.orgId);
    const drifting = standing(profile, card.date).filter((s) => s.drift.warning);
    for (const i of card.items) {
      if (i.kind === "sign_off") expect(orders.find((o) => o.orderId === i.orderId)?.status).toBe("pending_approval");
      if (i.kind === "delivery") expect(orders.find((o) => o.orderId === i.orderId)?.status).toBe("committed");
      if (i.kind === "drift") expect(drifting.map((s) => s.family)).toContain(i.family);
      if (i.kind === "recall") expect(radarStore(rt.dock).state.holds.some((h) => h.productId === i.productId && !h.liftedAt)).toBe(true);
    }
    // Every drifting recurring order is on it, and nothing else of that kind.
    expect(card.items.filter((i) => i.kind === "drift").map((i) => i.family).sort()).toEqual(drifting.map((s) => s.family).sort());
    expect(card.items.some((i) => i.kind === "recall")).toBe(false); // no hold on the radar

    // A second read the same day does not open the day again.
    expect(await openToday(k)).toBeUndefined();
    // The opening is in the ledger, with no model call behind it.
    expect(rt.dock.ledger.entries().some((e) => e.type === "agent" && (e.data as { event?: string }).event === "today")).toBe(true);
  });

  it("shows a sign-off waiting, and a recall hold on something the kitchen bought", async () => {
    const k = await kitchen("kaari", "Mira");
    const rt = await getRuntime();
    // An order over Kaari's €100 limit, from a sheet: it waits for the named person.
    const sheet = (await tap(k, { type: "sheet_add", productId: "VA-1010", packs: 60 })).find((c): c is SheetCard => c.type === "sheet")!;
    expect(sheet).toBeTruthy();
    await tap(k, { type: "sheet_place", sheetId: sheet.sheetId, version: sheet.version });
    const waiting = (await rt.dock.listOrders()).find((o) => o.orgId === k.info.orgId && o.status === "pending_approval");
    expect(waiting).toBeTruthy();

    const profile = await rt.kitchens.getProfile(k.info.orgId);
    const bought = profile!.history[0].lines[0];
    radarStore(rt.dock).state.holds.push({ holdId: "hld_t", productId: bought.productId, productName: bought.name, noticeId: "n1", matchId: "m1", drill: true, reason: "Drill: listeria found in a batch.", noticeUrl: "https://example.test/notice", noticeTitle: "Recall drill", publisher: "Drill", placedAt: new Date().toISOString(), placedBy: "radar", refusals: 0 } as never);

    const cards = await tap(k, { type: "home_show", what: "today" });
    const today = cards.find((c) => c.type === "today") as TodayCard;
    if (!today) throw new Error(JSON.stringify(cards));
    const s = today.items.find((i) => i.kind === "sign_off");
    expect(s?.kind === "sign_off" && s.orderId).toBe(waiting!.orderId);
    const r = today.items.find((i) => i.kind === "recall");
    expect(r?.kind === "recall" && r.productId).toBe(bought.productId);
    expect(r?.kind === "recall" && r.drill).toBe(true);
  });
});

describe("buying from the home goes through the order sheet", () => {
  it("a product grid from master data, and its add puts the product on the sheet", async () => {
    const k = await kitchen("laakso");
    const grid = (await tap(k, { type: "products_search", query: "milk" })).find((c) => c.type === "products");
    if (grid?.type !== "products") throw new Error("no grid");
    expect(grid.products.length).toBeGreaterThan(0);
    const rt = await getRuntime();
    const m = (await rt.dock.authenticate(k.mandateToken, k.agentId)).mandate;
    for (const p of grid.products) {
      expect(m.allowedCategories).toContain(p.category);
      expect(p.allergens.some((a) => m.forbiddenAllergens.includes(a))).toBe(false);
    }
    const first = grid.products[0];
    const sheet = (await tap(k, { type: "sheet_add", productId: first.productId, packs: 2 })).find((c): c is SheetCard => c.type === "sheet");
    expect(sheet?.lines.map((l) => [l.productId, l.packs])).toEqual([[first.productId, 2]]);
    // Nothing was ordered: the sheet waits for the buyer's confirmation.
    expect((await rt.dock.listOrders()).filter((o) => o.orgId === k.info.orgId && o.createdAt > new Date(Date.now() - 60_000).toISOString())).toHaveLength(0);
  });

  it("order again puts an earlier order's lines on a new sheet", async () => {
    const k = await kitchen("kaari");
    const history = (await tap(k, { type: "home_show", what: "history" })).find((c) => c.type === "records");
    if (history?.type !== "records") throw new Error("no history");
    expect(history.repeatable).toBe(true);
    const row = history.rows.find((r) => r.ref)!;
    const cards = await tap(k, { type: "order_again", ref: row.ref! });
    const sheet = cards.find((c): c is SheetCard => c.type === "sheet");
    expect(sheet).toBeTruthy();
    const rt = await getRuntime();
    const earlier = (await rt.kitchens.getProfile(k.info.orgId))!.history.find((h) => h.orderId === row.ref);
    if (earlier) expect(sheet!.lines.map((l) => l.productId).sort()).toEqual(earlier.lines.map((l) => l.productId).sort());
  });

  it("a recurring order changed is a new sheet for its next day", async () => {
    const k = await kitchen("kaari");
    const list = (await tap(k, { type: "home_show", what: "standing" })).find((c) => c.type === "standing");
    if (list?.type !== "standing") throw new Error("no recurring orders");
    expect(list.items.length).toBeGreaterThan(0);
    const it0 = list.items[0];
    const sheet = (await tap(k, { type: "standing_change", family: it0.family, packs: it0.usualPacks + 1 })).find((c): c is SheetCard => c.type === "sheet");
    expect(sheet?.lines[0]).toMatchObject({ productId: it0.productId, packs: it0.usualPacks + 1 });
  });
});

describe("what the agent remembers", () => {
  it("a signed-in person edits and forgets an item, recorded as theirs; without one it is refused", async () => {
    const memory = await getMemoryService();
    const k0 = await kitchen("laakso");
    await memory.state(k0.info.orgId, { fact: { kind: "note", text: "We never take cream with carrageenan." }, by: "Aino" });
    const view = await memory.view(k0.info.orgId, k0.info.name);
    const item = view.items.find((i) => i.text.includes("carrageenan"))!;
    expect(item).toBeTruthy();

    // No signed-in person: the change is refused with a reason.
    const refused = await tap(k0, { type: "memory_forget", itemId: item.id });
    expect(refused.some((c) => c.type === "notice" && c.kind === "refused")).toBe(true);

    const k = await kitchen("laakso", "Aino Virtanen");
    const listed = (await tap(k, { type: "home_show", what: "memory" })).find((c) => c.type === "memory_list");
    if (listed?.type !== "memory_list") throw new Error("no memory list");
    expect(listed.canChange).toBe(true);
    expect(listed.items.map((i) => i.itemId)).toContain(item.id);

    await tap(k, { type: "memory_edit", itemId: item.id, text: "We never take cream with carrageenan or other thickeners." });
    expect((await memory.view(k.info.orgId)).items.find((i) => i.id === item.id)?.text).toMatch(/thickeners/);

    await tap(k, { type: "memory_forget", itemId: item.id });
    expect((await memory.view(k.info.orgId)).items.some((i) => i.id === item.id && i.status === "active")).toBe(false);
    const rt = await getRuntime();
    const writes = rt.dock.ledger.entries().filter((e) => e.type === "agent" && (e.data as { event?: string }).event === "memory_write");
    expect(writes.map((e) => (e.data as { by?: string }).by)).toEqual(["Aino Virtanen", "Aino Virtanen"]);
  });
});
