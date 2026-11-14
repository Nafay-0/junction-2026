import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { menuKitchen } from "../agent/menu/runtime";
import { kitchenAgent } from "../channels/flow";
import { resolveKitchen } from "../console-kitchens";
import { getRuntime, resetRuntime } from "../runtime";
import { licenceGate } from "./licence-gate";
import { STORE_PAGE_READ, onsiteSession } from "./onsite";

/**
 * The crash-test licence binds on every door. It used to be applied only in `authenticate` of server/http.ts, so
 * with DOCK_LICENCE_ENFORCE=on an agent was held to its licence over REST, MCP and the on-site console, and to its
 * mandate alone through the doors that call Dock in-process: the thread (the store's own agent), the voice call,
 * the photo door, the menu planner and the scripted buyer. The licence is now applied by the core's admission
 * hook, next to the suspension check, so there is no session without it.
 */
beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockMenu?: unknown; __dockMenuTokens?: unknown }).__dockMenu = undefined;
  process.env.DOCK_MENU_MODEL = "recorded";
  process.env.DOCK_LICENCE_BINDINGS = "/nonexistent/licence-bindings.json"; // nobody is licensed: everyone is L0
});
afterEach(() => {
  delete process.env.DOCK_LICENCE_BINDINGS;
});

describe("an unlicensed agent (L0: every order needs a person) on the in-process doors", () => {
  it("gets the licensed mandate from any session the runtime hands out", async () => {
    const { dock } = await getRuntime();
    const gate = licenceGate(dock);
    const k = (await resolveKitchen("kaari"))!;
    expect((await onsiteSession(dock, k, "thread typed door")).mandate.perOrderLimitCents).toBe(k.info.mandate.perOrderLimitCents); // enforcement off: the mandate's own limit

    gate.setEnforced(true);
    const thread = { ...(await onsiteSession(dock, k, "thread typed door")), door: "typed" as const }; // as thread/engine.ts builds it
    expect(thread.mandate.perOrderLimitCents).toBe(0);
    expect(gate.of(thread)).toMatchObject({ level: "L0", basis: "unlicensed", appliedLimitCents: 0 });
    expect((await kitchenAgent("kaari", undefined, "voice")).session.mandate.perOrderLimitCents).toBe(0);
    expect((await kitchenAgent("kaari", undefined, "photo")).session.mandate.perOrderLimitCents).toBe(0);
    expect((await dock.authenticate(k.mandateToken, k.agentId)).mandate.perOrderLimitCents).toBe(0);
    // The store's pages only read the kitchen's records: they show the mandate as the kitchen signed it.
    expect((await dock.authenticate(k.mandateToken, k.agentId, STORE_PAGE_READ)).mandate.perOrderLimitCents).toBe(k.info.mandate.perOrderLimitCents);
  });

  it("an order within the mandate's limit, placed through an in-process door, goes to a person and says the licence is why", async () => {
    const { dock } = await getRuntime();
    licenceGate(dock).setEnforced(true);
    const a = await kitchenAgent("laakso", undefined, "voice");
    const req = await dock.openRequest(a.session, { text: "20 L lactose-free milk" });
    const { quote, quoteToken } = await dock.requestQuote(a.session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const order = (await dock.placeOrder(a.session, { requestId: req.requestId, quoteToken, lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) })) as Awaited<ReturnType<typeof dock.placeOrder>> & { licence?: { level: string; decisive: boolean } };
    expect(order.status).toBe("pending_approval"); // €29.80, far inside Laakso's €1,000
    expect(order.licence).toMatchObject({ level: "L0", decisive: true });
    expect(dock.ledger.entries({ orderId: order.orderId }).some((e) => e.data.action === "licence_applied")).toBe(true);
  });

  it("the menu planner's agent is held to its licence too", async () => {
    const { rt, kitchen } = await menuKitchen("kaari");
    expect(kitchen!.mandate.perOrderLimitCents).toBeGreaterThan(0);
    licenceGate(rt.dock).setEnforced(true);
    // The session the planner quotes and orders with (agent/menu/service.ts session()).
    expect((await onsiteSession(rt.dock, kitchen!, "menu planner")).mandate.perOrderLimitCents).toBe(0);
  });
});
