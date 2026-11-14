import { beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { resetMemoryService } from "@/server/memory/runtime";
import { resetRuntime } from "@/server/runtime";
import { openToday, submitTurn, threadStore } from "./engine";
import type { Card } from "./types";

/**
 * The opening on Kahvila Sointu (a test kitchen whose recurring milk has drifted): the opening's card carries the drift
 * with its figures and the next due day, so the landing can ask one question; a plain "yes" to it puts that recurring
 * order at its usual amount on an order sheet for that day, by plain code.
 */

async function settle(slug: string, turnId: string) {
  const store = await threadStore();
  for (let i = 0; i < 200; i++) {
    const t = store.agentTurn(store.peek(slug)!, turnId);
    if (t && t.status !== "working") return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("turn did not settle");
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY = "off";
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_WATCH_MINUTES = "0";
});

describe("the opening's drift question", () => {
  it("says the drift with its figures, and a yes sets up the next one at the usual amount", async () => {
    const base = (await resolveKitchen("kahvila-sointu"))!;
    const k = { ...base, console: { kitchen: "kahvila-sointu", session: "s_sointu", person: { channel: "portal_session" as const, name: "Kahvila Sointu (kahvila-sointu)", account: "kahvila-sointu" } } } as Kitchen;
    const opening = await openToday(k);
    const o = await settle("kahvila-sointu", opening!);
    const today = o.cards.find((c) => c.type === "today");
    const drift = today?.type === "today" ? today.items.find((i) => i.kind === "drift") : undefined;
    expect(drift?.kind).toBe("drift");
    if (drift?.kind !== "drift") return;
    expect(drift.usual.amount).toBeGreaterThan(0);
    expect(drift.amountPct ?? drift.pricePct).not.toBeNull();
    expect(drift.nextDue).toBeTruthy();
    expect(today?.type === "today" && today.items.some((i) => i.kind === "sign_off")).toBe(false);
    const r = await submitTurn(k, { door: "typed", via: "typed", text: "yes" });
    const a = await settle("kahvila-sointu", r.agentTurnId);
    const sheet = a.cards.find((c: Card) => c.type === "sheet");
    expect(sheet?.type).toBe("sheet");
    if (sheet?.type === "sheet") expect(sheet.deliveryDate).toBe(drift.nextDue);
  }, 30_000);
});
