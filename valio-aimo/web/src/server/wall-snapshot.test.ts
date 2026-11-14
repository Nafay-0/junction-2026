import { beforeEach, describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/core/ledger";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { resolveKitchen } from "./console-kitchens";
import { liveCheck } from "./kitchen-portal";
import { getRuntime, resetRuntime } from "./runtime";
import { progress, wallSnapshot } from "./wall-snapshot";

beforeEach(() => {
  process.env.DOCK_CATALOG = "seed";
  resetRuntime();
});

const entry = (seq: number, type: LedgerEntry["type"], data: Record<string, unknown>): LedgerEntry => ({ seq, at: `2026-11-14T10:0${seq}:00.000Z`, type, actor: "dock", summary: "", requestId: "req_1", data, prevHash: "", hash: "" });

describe("the wall", () => {
  it("does not show a buyer opening products in the catalogue as a request stuck at 'Checking live prices'", async () => {
    const k = await resolveKitchen("kaari");
    await liveCheck(k!, ["VA-1010"]);
    const rt = await getRuntime();
    expect(rt.dock.ledger.entries().some((e) => e.type === "lookup")).toBe(true);
    const wall = await wallSnapshot(rt);
    expect(wall.feed.filter((f) => /Checking live prices/.test(f.status))).toEqual([]);
  });

  it("says a fixed price ran out when nobody ordered on it, instead of 'Price fixed' for ever", () => {
    const list = [entry(1, "request", { text: "100 L milk" }), entry(2, "quote", { totalCents: 12_900, expiresAt: "2026-11-14T10:30:00.000Z" })];
    expect(progress(list, new Date("2026-11-14T10:10:00.000Z")).status).toMatch(/^Price fixed at/);
    expect(progress(list, new Date("2026-11-14T10:31:00.000Z")).status).toBe("Price ran out; not ordered");
    const decided = [...list, entry(3, "decision", { outcome: "auto_approve", totalCents: 12_900 })];
    expect(progress(decided, new Date("2026-11-14T10:31:00.000Z")).status).toBe("Within the agent's mandate");
  });

  it("reads the ledger incrementally: counts, feed and refusals follow new orders, and an idle poll reuses the last snapshot", async () => {
    const rt = await getRuntime();
    const BIG = 1_000_000_000;
    const token = await signMandate(demoMandate(new Date(), { perOrderLimitCents: BIG, weeklyBudgetCents: BIG, approvers: [{ role: "x", name: "X", maxApprovalCents: BIG }] }), await demoOrgKeyPair());
    const session = await rt.dock.authenticate(token, DEMO_ORG.agentId);
    const buy = async (text: string, neededBy: string) => {
      const r = await rt.dock.openRequest(session, { text, productIds: ["VA-1001"], neededBy });
      const q = await rt.dock.requestQuote(session, { requestId: r.requestId, lines: [{ productId: "VA-1001", quantity: 40 }] });
      return rt.dock.placeOrder(session, { requestId: r.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    };
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    expect((await buy("40 L milk, first", day(3))).status).toBe("committed");
    const first = await wallSnapshot(rt);
    expect(first.counters).toMatchObject({ orders: 1, agentAlone: 1, humanSignedOff: 0, waiting: 0 });
    expect(first.chain).toEqual({ ok: true, length: rt.dock.ledger.length });
    expect(first.feed[0]).toMatchObject({ what: "40 L milk, first", reached: 5 });
    // The route strips the kitchens' slugs on its copy; the cached snapshot keeps them.
    const again = await wallSnapshot(rt);
    again.kitchens = [];
    expect(again.feed).toEqual(first.feed);
    expect((await wallSnapshot(rt)).kitchens).toEqual(first.kitchens);

    expect((await buy("40 L milk, second", day(4))).status).toBe("committed");
    const refused = await rt.dock.authenticate(await signMandate(demoMandate(new Date(), { mandateId: "mnd_tight", weeklyBudgetCents: 100 }), await demoOrgKeyPair()), DEMO_ORG.agentId);
    const r = await rt.dock.openRequest(refused, { text: "40 L milk, over budget", productIds: ["VA-1001"], neededBy: day(5) });
    const q = await rt.dock.requestQuote(refused, { requestId: r.requestId, lines: [{ productId: "VA-1001", quantity: 40 }] });
    expect((await rt.dock.placeOrder(refused, { requestId: r.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) })).status).toBe("rejected");
    const later = await wallSnapshot(rt);
    expect(later.counters).toMatchObject({ orders: 2, agentAlone: 2, refused: 1 });
    expect(later.feed.map((f) => f.what)).toEqual(["40 L milk, over budget", "40 L milk, second", "40 L milk, first"]);
    expect(later.refusals[0]).toMatchObject({ kitchen: DEMO_ORG.name });
    expect(later.chain).toEqual({ ok: true, length: rt.dock.ledger.length });
  });
});
