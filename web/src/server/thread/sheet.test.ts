import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { resetMemoryService } from "@/server/memory/runtime";
import { addDaysIso, localNow } from "@/core/kitchen";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { submitTurn, threadStore } from "./engine";
import type { Card, OrderCard, SheetCard } from "./types";

/**
 * The order sheet's safety rails (docs/agent-thread.md "Widgets"): a removed line comes back with one tap, and a
 * placed order can be taken back before the order cut-off, by the kitchen's signed-in person only.
 */

async function kitchen(slug: string, person?: string): Promise<Kitchen> {
  const k = (await resolveKitchen(slug))!;
  return { ...k, console: { kitchen: slug, session: `test-${slug}`, ...(person ? { person: { channel: "portal_session" as const, name: person } } : {}) } } as Kitchen;
}

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

/** The sheet as it stands now, wherever in the thread it was first drawn. */
async function sheetNow(k: Kitchen, sheetId: string): Promise<SheetCard> {
  const t = (await threadStore()).peek(k.info.slug)!;
  return t.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).find((c): c is SheetCard => c.type === "sheet" && c.sheetId === sheetId)!;
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

describe("the order sheet", () => {
  it("puts a removed line back with one tap", async () => {
    const k = await kitchen("kaari", "Mikael Laine");
    const first = (await tap(k, { type: "sheet_add", productId: "VA-1010", packs: 2 })).find((c): c is SheetCard => c.type === "sheet")!;
    await tap(k, { type: "sheet_add", sheetId: first.sheetId, version: first.version, productId: "VA-1001", packs: 3 });
    let s = await sheetNow(k, first.sheetId);
    expect(s.lines.map((l) => l.productId).sort()).toEqual(["VA-1001", "VA-1010"]);
    const gone = s.lines.find((l) => l.productId === "VA-1001")!;
    await tap(k, { type: "sheet_remove", sheetId: s.sheetId, version: s.version, lineId: gone.lineId });
    s = await sheetNow(k, first.sheetId);
    expect(s.lines.map((l) => l.productId)).toEqual(["VA-1010"]);
    expect(s.removed).toMatchObject({ productId: "VA-1001", packs: 3 });
    await tap(k, { type: "sheet_add", sheetId: s.sheetId, version: s.version, productId: s.removed!.productId, packs: s.removed!.packs });
    s = await sheetNow(k, first.sheetId);
    expect(s.lines.find((l) => l.productId === "VA-1001")?.packs).toBe(3);
    expect(s.removed).toBeUndefined();
  });

  it("a placed order is taken back before the cut-off by the signed-in person, and never by a relayed tap", async () => {
    const k = await kitchen("laakso", "Aino Virtanen");
    const rt = await getRuntime();
    (rt.catalog as unknown as { setStock(id: string, p: { orderBy: string }): void }).setStock("VA-1010", { orderBy: `${addDaysIso(localNow(new Date()).date, 1)}T12:00` });
    const sheet = (await tap(k, { type: "sheet_add", productId: "VA-1010", packs: 2 })).find((c): c is SheetCard => c.type === "sheet")!;
    expect(sheet.gate.outcome).toBe("auto_approve");
    const placed = await tap(k, { type: "sheet_place", sheetId: sheet.sheetId, version: sheet.version });
    const order = placed.find((c): c is OrderCard => c.type === "order")!;
    expect(order.status).toBe("committed");
    expect(order.takeBackUntil).toBeTruthy();
    expect(Date.parse(order.takeBackUntil)).toBeGreaterThan(Date.now());

    // Without a signed-in person the tap is relayed: a committed order stays as it is.
    const relayed = await kitchen("laakso");
    const refused = await tap(relayed, { type: "withdraw", orderId: order.orderId });
    expect(refused.some((c) => c.type === "notice")).toBe(true);

    await tap(k, { type: "withdraw", orderId: order.orderId });
    // The order's card changes where it is: the sheet then says it was taken back.
    const t = (await threadStore()).peek(k.info.slug)!;
    const now = t.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).find((c): c is OrderCard => c.type === "order" && c.orderId === order.orderId);
    expect(now?.status).toBe("withdrawn");
    expect(now?.takeBackUntil).toBeUndefined();
  });
});
