import { describe, expect, it } from "vitest";
import { checkOrderQueries, QUERY_NOW, randomOrders } from "./order-queries.fixtures";
import { InMemoryDockRepository, recentOrderOf } from "./orders";
import { SPLIT_NAMED_MAX, evaluatePolicy, type SplitWindow } from "./policy";
import { sampleMandate } from "./test-fixtures";

const same = (actual: unknown, expected: unknown, what: string) => expect(actual, what).toEqual(expected);

describe("the in-memory store's order queries", () => {
  it("answer as listOrders plus a filter would, for every organisation and window", async () => {
    const repo = new InMemoryDockRepository();
    const all = randomOrders(400);
    for (const o of all) await repo.saveOrder(o); // created in random time order: the per-organisation index sorts
    await checkOrderQueries(repo, all, same);
  });

  it("keep their indexes when orders change status (pending -> committed, expired, withdrawn) and gain an approval", async () => {
    const repo = new InMemoryDockRepository();
    const all = randomOrders(200, 11);
    for (const o of all) await repo.saveOrder(o);
    for (const [i, o] of all.entries()) {
      if (o.status !== "pending_approval") continue;
      o.status = (["committed", "expired", "withdrawn"] as const)[i % 3];
      await repo.saveOrder(o);
    }
    const late = { ...randomOrders(1, 99)[0], orderId: "ord_late", status: "pending_approval" as const };
    await repo.saveOrder({ ...late, approval: undefined });
    await repo.saveOrder({ ...late, approval: { approvalId: "apr_late", approver: { role: "r", name: "R", maxApprovalCents: 1 }, status: "pending", orderDigest: "d", tokenHash: "t", requestedAt: late.createdAt } });
    all.push({ ...late, approval: { approvalId: "apr_late", approver: { role: "r", name: "R", maxApprovalCents: 1 }, status: "pending", orderDigest: "d", tokenHash: "t", requestedAt: late.createdAt } });
    await checkOrderQueries(repo, all, same);
    expect((await repo.getOrderByApprovalId("apr_late"))?.orderId).toBe("ord_late");
  });

  it("hand out copies: changing what a query returned changes nothing stored", async () => {
    const repo = new InMemoryDockRepository();
    const all = randomOrders(30, 3);
    for (const o of all) await repo.saveOrder(o);
    const [first] = await repo.ordersOf(all[0].orgId);
    first.status = "rejected";
    first.totalCents = -1;
    expect((await repo.getOrder(first.orderId))?.totalCents).not.toBe(-1);
  });
});

describe("order_splitting on the store's sums", () => {
  it("decides as it does on the full list, and names only the newest few of a busy day", async () => {
    const m = sampleMandate(QUERY_NOW, { perOrderLimitCents: 10_000, weeklyBudgetCents: 1_000_000 });
    const quote = { quoteId: "qt_new", buyerOrgId: m.issuer.orgId, agentId: m.agentId, mandateId: m.mandateId, requestId: "req_new", currency: "EUR" as const, lines: [{ productId: "VA-1001", name: "Milk", category: "milk", unit: "l", packSize: 1, attributes: [], allergens: [], certificates: [], quantity: 5, unitPriceCents: 1_000, lineTotalCents: 5_000, deliveryDate: "2026-11-16" }], totalCents: 5_000, issuedAt: QUERY_NOW.toISOString(), expiresAt: new Date(QUERY_NOW.getTime() + 1800_000).toISOString() };
    const draft = { agentId: m.agentId, quote, lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) };
    const earlier = Array.from({ length: 40 }, (_, i) => ({
      ...recentOrderOf({ ...randomOrders(1, i + 1)[0], orderId: `ord_${String(i).padStart(2, "0")}`, status: "committed", approval: undefined, totalCents: 200 }),
      categories: ["milk"],
      placedAt: new Date(QUERY_NOW.getTime() - (40 - i) * 60_000).toISOString(),
    }));
    const base = { now: QUERY_NOW, spentThisWeekCents: 0, quoteAlreadyUsed: false };
    const fromList = evaluatePolicy(m, draft, { ...base, recentOrders: earlier });
    const window: SplitWindow = { count: earlier.length, totalCents: earlier.reduce((s, o) => s + o.totalCents, 0), latest: [...earlier].reverse().slice(0, SPLIT_NAMED_MAX) };
    const fromSums = evaluatePolicy(m, draft, { ...base, splitWindow: window });
    const rule = (d: typeof fromList) => d.rules.find((r) => r.rule === "order_splitting")!;
    expect(rule(fromList).outcome).toBe("escalate");
    expect(fromSums.outcome).toBe(fromList.outcome);
    expect(rule(fromSums)).toEqual(rule(fromList));
    // 40 earlier orders: 30 counted, the newest 10 named, oldest first.
    expect(rule(fromSums).reason).toMatch(/^Looks like one need split into smaller orders: with 30 earlier orders \(€60\.00\), ord_30 \(€2\.00\), .*ord_39 \(€2\.00\) placed alone/);
    expect(rule(fromSums).details).toMatchObject({ earlierCount: 40, earlierCents: 8_000, combinedCents: 13_000 });
    expect((rule(fromSums).details as { earlier: unknown[] }).earlier).toHaveLength(SPLIT_NAMED_MAX);
  });
});
