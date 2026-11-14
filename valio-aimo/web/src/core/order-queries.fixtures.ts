import type { DockRepository, Order, OrderStatus } from "./orders";
import { recentOrderOf } from "./orders";
import type { SplitWindow } from "./policy";

/**
 * A store's order queries (DockRepository ordersOf, spendOf, splitWindow, the pending orders) checked against the
 * plain filters they replace, on a random mix of orders: several organisations, statuses, categories, approvals,
 * creation times over a week and quotes expiring either side of "now". Shared by the in-memory test and the
 * PostgreSQL one (aiven.live.test.ts), so both stores answer exactly as listOrders plus a filter would.
 */
export const QUERY_NOW = new Date("2026-11-14T12:00:00.000Z");

export function randomOrders(n: number, seed = 7): Order[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const orgs = ["org_a", "org_b", "org_c"];
  const statuses: OrderStatus[] = ["committed", "committed", "committed", "pending_approval", "rejected", "declined", "withdrawn", "expired"];
  const categories = ["milk", "cream", "yoghurt", "cheese"];
  const out: Order[] = [];
  for (let i = 0; i < n; i++) {
    const created = new Date(QUERY_NOW.getTime() - Math.floor(rnd() * 9 * 86_400_000)); // up to 9 days back
    const status = pick(statuses);
    const cats = rnd() < 0.3 ? [pick(categories), pick(categories)] : [pick(categories)];
    const signed = status === "committed" ? rnd() < 0.3 : status === "pending_approval" || status === "declined" || status === "withdrawn" || status === "expired";
    const expires = new Date(created.getTime() + 30 * 60_000 + (rnd() < 0.5 ? 9 * 86_400_000 : 0)); // half still valid at QUERY_NOW
    out.push({
      orderId: `ord_${String(i).padStart(4, "0")}`,
      requestId: `req_${Math.floor(i / 2)}`, // two orders per request
      orgId: pick(orgs),
      orgName: "Org",
      agentId: "agent_1",
      mandateId: "mnd_1",
      quoteId: `qt_${i}`,
      status,
      lines: cats.map((category, j) => ({ productId: `P-${j}`, name: "p", category, unit: "L" as const, packSize: 1, attributes: [], allergens: [], certificates: [], quantity: 1 + j, unitPriceCents: 100, lineTotalCents: 100, deliveryDate: `2026-11-${String(15 + j).padStart(2, "0")}` })),
      totalCents: 100 + Math.floor(rnd() * 100_000),
      decision: { outcome: "auto_approve", totalCents: 0, rules: [], reasons: [] },
      ...(signed ? { approval: { approvalId: `apr_${i}`, approver: { role: "r", name: "R", maxApprovalCents: 1 }, status: "pending", orderDigest: "d", tokenHash: "t", requestedAt: created.toISOString() } } : {}),
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      quote: { quoteId: `qt_${i}`, buyerOrgId: "org", agentId: "agent_1", mandateId: "mnd_1", requestId: `req_${Math.floor(i / 2)}`, currency: "EUR", lines: [], totalCents: 0, issuedAt: created.toISOString(), expiresAt: expires.toISOString() },
      draftLines: [],
      mandate: {} as Order["mandate"],
    } as Order);
  }
  return out;
}

type Expect = (actual: unknown, expected: unknown, what: string) => void;

/** Every query against its plain filter over `all` (what was saved), for each organisation and a few windows. */
export async function checkOrderQueries(repo: DockRepository, all: Order[], same: Expect): Promise<void> {
  const ids = (xs: Order[]) => xs.map((o) => o.orderId);
  const byTime = (xs: Order[]) => [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.orderId.localeCompare(b.orderId));
  const at = QUERY_NOW.toISOString();
  const t = QUERY_NOW.getTime();
  for (const orgId of ["org_a", "org_b", "org_c", "org_none"]) {
    const mine = all.filter((o) => o.orgId === orgId);
    same(ids(await repo.ordersOf(orgId)), ids(byTime(mine)), `ordersOf ${orgId}`);
    for (const days of [1, 7]) {
      const since = new Date(t - days * 86_400_000).toISOString();
      const inWindow = mine.filter((o) => o.createdAt > since);
      same(ids(await repo.ordersOf(orgId, since)), ids(byTime(inWindow)), `ordersOf ${orgId} since ${days} d`);
      for (const exclude of [undefined, inWindow[0]?.orderId]) {
        const rest = inWindow.filter((o) => o.orderId !== exclude);
        const held = byTime(rest.filter((o) => o.status === "pending_approval" && Date.parse(o.quote.expiresAt) > t));
        same(await repo.spendOf(orgId, { since, at, excludeOrderId: exclude }), {
          committedCents: rest.filter((o) => o.status === "committed").reduce((s, o) => s + o.totalCents, 0),
          held: held.map((o) => ({ orderId: o.orderId, totalCents: o.totalCents, expiresAt: o.quote.expiresAt })),
        }, `spendOf ${orgId} ${days} d excluding ${exclude}`);
        for (const categories of [["milk"], ["cream", "cheese"], []]) {
          const requestId = rest[0]?.requestId ?? "req_none";
          const related = rest
            .filter((o) => o.status === "committed" || o.status === "pending_approval") // what orders.ts used to read
            .map(recentOrderOf)
            .filter((o) => o.authorisedBy === "mandate" && (o.requestId === requestId || o.categories.some((c) => categories.includes(c))));
          const newest = [...related].sort((a, b) => b.placedAt.localeCompare(a.placedAt) || b.orderId.localeCompare(a.orderId));
          const expected: SplitWindow = { count: related.length, totalCents: related.reduce((s, o) => s + o.totalCents, 0), latest: newest.slice(0, 3) };
          const got = await repo.splitWindow(orgId, { since, requestId, categories, excludeOrderId: exclude, latest: 3 });
          same(normalise(got), normalise(expected), `splitWindow ${orgId} ${days} d ${categories.join("+")}`);
        }
      }
    }
    same(ids(await repo.pendingOrders(orgId)), ids(byTime(mine.filter((o) => o.status === "pending_approval"))), `pendingOrders ${orgId}`);
    same(ids(await repo.pendingExpired(at, orgId)), ids(byTime(mine.filter((o) => o.status === "pending_approval" && Date.parse(o.quote.expiresAt) <= t))), `pendingExpired ${orgId}`);
  }
  same(ids(await repo.pendingOrders()), ids(byTime(all.filter((o) => o.status === "pending_approval"))), "pendingOrders, all");
  same(await repo.pendingCount(), all.filter((o) => o.status === "pending_approval").length, "pendingCount");
  same(ids(await repo.pendingExpired(at)), ids(byTime(all.filter((o) => o.status === "pending_approval" && Date.parse(o.quote.expiresAt) <= t))), "pendingExpired, all");
  for (const requestId of ["req_0", "req_3", "req_none"]) same(ids(await repo.ordersOfRequest(requestId)).sort(), ids(all.filter((o) => o.requestId === requestId)).sort(), `ordersOfRequest ${requestId}`);
  const withApproval = all.find((o) => o.approval)!;
  same((await repo.getOrderByApprovalId(withApproval.approval!.approvalId))?.orderId, withApproval.orderId, "getOrderByApprovalId");
}

function normalise(w: SplitWindow) {
  return { ...w, latest: w.latest.map((o) => ({ ...o, categories: [...o.categories].sort(), deliveryDates: [...o.deliveryDates].sort() })) };
}
