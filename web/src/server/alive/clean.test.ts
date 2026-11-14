import { describe, expect, it } from "vitest";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { credentialsFor, deliveryDay, onsiteAgent } from "./agents";
import { cleanSample, sampleCheck } from "./clean";
import { play } from "./clock";
import { isSampleOrder } from "./marks";
import { intakeOrder, milkNeed } from "./story";

/**
 * What the earlier sample (before it kept to its own kitchens) left in Kaari: an order waiting for the head chef, an
 * order placed alone (in the kitchen's history), a staged stock-out, auto-renew switched on, sample turns in the
 * conversation. The clean-up clears exactly those, and leaves what a person did there alone.
 */
describe("clearing an earlier sample from kitchens people sign into", () => {
  it("takes back, lifts, forgets and starts over only what the sample marked as its own", async () => {
    resetRuntime();
    Object.assign(process.env, { DOCK_MEMORY_LLM: "off", DOCK_RATE_LIMITS: "off" });
    const rt = await getRuntime();
    const w = await import("@/server/watch/service");
    const { threadStore } = await import("@/server/thread/engine");
    const store = await threadStore();
    const thread = store.get("kaari", "org_ravintola_kaari");
    const set = "smp_old_test";
    // The old sample, in Kaari.
    const left = await play(set, 0, "old sample", async () => {
      const a = onsiteAgent(await credentialsFor(rt, "kaari"), "kaari", "old-sample");
      const waiting = await intakeOrder(a, milkNeed(140, deliveryDay(new Date(), 2)), "Sanna Koskinen (head chef)");
      const alone = await intakeOrder(a, milkNeed(40, deliveryDay(new Date(), 2)), "Sanna Koskinen (head chef)");
      const session = await rt.dock.authenticate((await credentialsFor(rt, "kaari")).mandateToken, "agent_kaari_buyer_01", { via: "onsite" } as never);
      const p = (await w.standingFor(rt, "org_ravintola_kaari")).find((x) => x.next)!;
      await w.stageStockOut(rt, { kitchen: "kaari", productId: p.product.productId, by: "Operations (sample)" });
      await w.setAutoRenew(rt, session, { family: p.family, on: true, by: "Kitchen manager (sample)", via: "the sample activity", renewNow: false });
      rt.dock.ledger.append({ type: "agent", actor: "agent:agent_kaari_buyer_01", summary: "The buyer said (typed): \"Ten kilos of yoghurt\"", data: { event: "turn", words: "Ten kilos of yoghurt", thread: { threadId: thread.threadId, turnId: "trn_old", door: "typed" } } });
      thread.turns.push({ turnId: "trn_old", role: "buyer", at: new Date().toISOString(), door: "typed", via: "typed", text: "Ten kilos of yoghurt" } as never);
      return { waiting: waiting.order!, alone: alone.order! };
    });
    expect(left.waiting.status).toBe("pending_approval");
    // A person's own order in Kaari, waiting too: never touched.
    const mine = await intakeOrder(onsiteAgent(await credentialsFor(rt, "kaari"), "kaari", "a-person"), milkNeed(150, deliveryDay(new Date(), 3)), "Sanna Koskinen (head chef)");
    expect(mine.order!.status).toBe("pending_approval");

    const before = await sampleCheck(rt);
    const kaariBefore = before.kitchens.find((k) => k.kitchen === "kaari")!;
    expect(kaariBefore.sampleTurnsInConversation).toBe(true);
    expect(kaariBefore.sampleOrdersWaiting).toBeGreaterThanOrEqual(1);

    const report = await cleanSample(rt, "Test staff");
    const kaari = report.find((r) => r.kitchen === "kaari")!.done.join(" | ");
    expect(kaari).toContain(`took back ${left.waiting.orderId}`);
    expect(kaari).toMatch(/lifted staged stock_out/);
    expect(kaari).toMatch(/auto-renew off/);
    expect(kaari).toMatch(/started the conversation over/);

    const after = await sampleCheck(rt);
    expect(after.kitchens.every((k) => !k.sampleTurnsInConversation && k.sampleOrdersWaiting === 0)).toBe(true);
    expect(after.sampleWaitingInSignable).toBe(0);
    // The person's order still waits; the sample's order is withdrawn; nothing left the ledger.
    const orders = await rt.dock.listOrders({ orgId: "org_ravintola_kaari" });
    expect(orders.find((o) => o.orderId === mine.order!.orderId)?.status).toBe("pending_approval");
    expect(orders.find((o) => o.orderId === left.waiting.orderId)?.status).toBe("withdrawn");
    expect(isSampleOrder(rt.dock.ledger, { orderId: String(left.waiting.orderId) })).toBe(true);
    expect(rt.dock.ledger.verifyFull().ok).toBe(true);
    // The kitchen's history no longer carries the sample's order placed alone.
    const profile = await rt.kitchens.getProfile("org_ravintola_kaari");
    if (left.alone.status === "committed") expect(profile!.history.some((h) => h.orderId === left.alone.orderId)).toBe(false);
    expect((await w.watchView(rt)).stages.filter((g) => g.orgId === "org_ravintola_kaari" && !g.liftedAt)).toEqual([]);
    // Twice is safe: nothing more to do.
    const again = await cleanSample(rt, "Test staff");
    expect(again.every((r) => r.done.length === 0)).toBe(true);
  }, 60_000);
});
