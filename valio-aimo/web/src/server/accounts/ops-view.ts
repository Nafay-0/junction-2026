import type { Runtime } from "../runtime";
import { testAccountsShown, testResetMinutes } from "./schedule";

/**
 * The operations portal's list of accounts: each as a kitchen (its store address, restaurant name and kind), when it
 * signed up and when it last ordered. Nothing else about the person: there is nothing else to show.
 */
export type AccountRow = { kitchen: string; restaurant: string; kind: "own" | "demo" | "test"; signedUpAt: string; lastOrderAt?: string; orders: number; hasKitchen: boolean };

export async function accountsView(rt: Runtime): Promise<{ accounts: AccountRow[]; testAccounts: { shown: boolean; resetMinutes: number } }> {
  const [accounts, orders] = await Promise.all([rt.accounts.list(), rt.dock.listOrders()]);
  const byOrg = new Map<string, { n: number; last?: string }>();
  for (const o of orders) {
    const x = byOrg.get(o.orgId) ?? { n: 0 };
    x.n++;
    if (!x.last || o.createdAt > x.last) x.last = o.createdAt;
    byOrg.set(o.orgId, x);
  }
  const rows = accounts.map((a) => {
    const o = a.orgId ? byOrg.get(a.orgId) : undefined;
    return { kitchen: a.username, restaurant: a.restaurant, kind: a.kind, signedUpAt: a.createdAt, lastOrderAt: o?.last, orders: o?.n ?? 0, hasKitchen: !!a.kitchen };
  });
  rows.sort((a, b) => (b.lastOrderAt ?? b.signedUpAt).localeCompare(a.lastOrderAt ?? a.signedUpAt));
  return { accounts: rows, testAccounts: { shown: testAccountsShown(), resetMinutes: testResetMinutes() } };
}
