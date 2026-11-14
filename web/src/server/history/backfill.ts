import type { KitchenProfile } from "@/core/kitchen";
import type { LedgerEntry } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import type { Order, PurchaseRequest } from "@/core/orders";
import type { Hold } from "../radar/types";
import { suspensionsFromLedger } from "../mariadb/attach";
import { HistoryMirror } from "../mariadb/mirror";
import type { GateSources } from "../mariadb/rows";
import type { HistoryStore } from "./store";

/**
 * Building the history from the ledger once, so the time machine has the whole past and not only what happened
 * after the deploy. The app's state is read as it stood at each moment the ledger records a change the gate reads
 * (an order decided, signed, placed, taken back; a suspension; a hold; a kitchen rule stated), oldest first, and the
 * same mirror writes what differs, stamped with that moment. Idempotent: a finished run is recorded and not repeated;
 * a run that was interrupted is cleared and run again from the start.
 *
 * What the past is read from:
 *   orders         every order the store has, with its status at the moment (from its own ledger entries)
 *   mandates       the terms each agent presented last by the moment: with a request (it names the mandate) or an
 *                  order (it carries the terms); a mandate presented without a request is not in the ledger
 *   kitchen rules  rules stated by then (statedAt), remembered habits created by then (createdAt), as they read now
 *   holds          placed by then, and lifted only if lifted by then
 *   suspensions    from the ledger's control entries up to the moment
 * A rule a kitchen later removed, or a habit it later changed, is not in the app's state any more, so the past shows
 * it as it reads now or not at all; everything after this run is mirrored as it happens.
 */
export const BACKFILL_KEY = "backfill:app";

export type BackfillSources = {
  ledger: readonly LedgerEntry[];
  orders: Order[];
  requests: Map<string, PurchaseRequest>;
  unverified: Map<string, { code: string; message: string; by: string }[]>;
  kitchens: KitchenProfile[];
  holds: Hold[];
};

export type BackfillReport = { ran: boolean; moments: number; writes: number; throughSeq: number; ms: number; at: string; note?: string };

const ORDER_TYPES = new Set(["decision", "approval", "order"]);

/** An order as it stood at moment `t`: its status from its own ledger entries up to then. Undefined before it existed. */
export function orderAsOf(o: Order, entries: readonly LedgerEntry[], t: number): Order | undefined {
  if (Date.parse(o.createdAt) > t) return undefined;
  let status: Order["status"] | undefined;
  let last = Date.parse(o.createdAt);
  let decided = false;
  for (const e of entries) {
    const at = Date.parse(e.at);
    if (at > t) break;
    last = Math.max(last, at);
    const d = e.data as Record<string, unknown>;
    if (e.type === "decision") status = d.outcome === "needs_human_approval" ? "pending_approval" : d.outcome === "reject" ? "rejected" : "committed";
    else if (e.type === "approval") {
      decided = d.decision === "approved" || d.decision === "declined";
      if (d.decision === "declined") status = "declined";
      else if (d.decision === "withdrawn") status = "withdrawn";
      else if (d.decision === "expired") status = "expired";
    } else if (e.type === "order") status = d.decision === "taken_back" ? "withdrawn" : typeof d.replaces === "string" && e.orderId !== o.orderId ? status : "committed";
  }
  // No entry yet (or one this mapping does not know): the order's own status is the best there is.
  const s = status ?? o.status;
  const iso = new Date(last).toISOString();
  return {
    ...o,
    status: s,
    updatedAt: iso,
    ...(o.approval ? { approval: s === "pending_approval" && !decided ? { ...o.approval, status: "pending", decidedAt: undefined } : o.approval } : {}),
  };
}

const mandatesOf = new WeakMap<BackfillSources, Map<string, Mandate>>();
/** Every mandate an order carried, by id. */
function mandateById(src: BackfillSources): Map<string, Mandate> {
  let m = mandatesOf.get(src);
  if (!m) mandatesOf.set(src, (m = new Map(src.orders.map((o) => [o.mandate.mandateId, o.mandate]))));
  return m;
}

/** The app's state as it stood at moment `t`, for the mirror. */
export function sourcesAsOf(src: BackfillSources, byOrder: Map<string, LedgerEntry[]>, t: number): GateSources {
  const orders = src.orders.map((o) => orderAsOf(o, byOrder.get(o.orderId) ?? [], t)).filter((o): o is Order => !!o);
  // The mandate each agent presented last: with its orders, and with each request it opened (the request names the
  // mandate; an order of any request carries its full terms).
  const latest = new Map<string, { m: Mandate; at: number }>();
  const see = (m: Mandate, at: number) => {
    const prev = latest.get(m.agentId);
    if (!prev || prev.at <= at) latest.set(m.agentId, { m, at });
  };
  for (const o of orders) see(o.mandate, Date.parse(o.createdAt));
  for (const r of src.ledger) {
    const at = Date.parse(r.at);
    if (at > t) break;
    if (r.type !== "request" || typeof r.data.mandateId !== "string") continue;
    const m = mandateById(src).get(r.data.mandateId);
    if (m) see(m, at);
  }
  const mandates = [...latest.values()].map((x) => x.m).filter((m) => Date.parse(m.validUntil) > t);
  const kitchens = src.kitchens.map((p) => ({
    ...p,
    stated: p.stated.filter((s) => !s.statedAt || Date.parse(s.statedAt) <= t),
    ...(p.memory ? { memory: { ...p.memory, items: p.memory.items.filter((i) => !i.createdAt || Date.parse(i.createdAt) <= t) } } : {}),
  }));
  const holds = src.holds.filter((h) => Date.parse(h.placedAt) <= t).map((h) => (h.liftedAt && Date.parse(h.liftedAt) > t ? { ...h, liftedAt: undefined, liftedBy: undefined, liftReason: undefined } : h));
  const suspensions = suspensionsFromLedger(src.ledger.filter((e) => Date.parse(e.at) <= t));
  return { now: new Date(t), mandates, orders, requests: src.requests, unverified: src.unverified, kitchens, holds, suspensions };
}

/** Every moment something the gate reads changed, oldest first (one per distinct millisecond). */
export function momentsOf(src: BackfillSources): number[] {
  const set = new Set<number>();
  for (const e of src.ledger) if (ORDER_TYPES.has(e.type) || e.type === "control" || (e.type === "request" && typeof e.data.mandateId === "string")) set.add(Date.parse(e.at));
  for (const o of src.orders) set.add(Date.parse(o.createdAt));
  for (const h of src.holds) {
    set.add(Date.parse(h.placedAt));
    if (h.liftedAt) set.add(Date.parse(h.liftedAt));
  }
  for (const p of src.kitchens) for (const s of p.stated) if (s.statedAt) set.add(Date.parse(s.statedAt));
  return [...set].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

/**
 * Write the history of `writer` from the past, once. `force`: run even if a finished run is recorded. Returns what
 * it did; never leaves a half-written history marked as done.
 */
export async function backfill(store: HistoryStore, writer: string, src: BackfillSources, opts: { force?: boolean; now?: Date; log?: (line: string) => void } = {}): Promise<BackfillReport> {
  const t0 = performance.now();
  const now = opts.now ?? new Date();
  await store.ensure();
  const done = await store.getMeta(BACKFILL_KEY);
  if (done && !opts.force) {
    const prev = JSON.parse(done) as BackfillReport;
    return { ...prev, ran: false, note: `already built from the ledger on ${prev.at}` };
  }
  // An interrupted run (or a store written before this existed): start clean, so the result is the same either way.
  await store.clearWriter(writer);
  const byOrder = new Map<string, LedgerEntry[]>();
  for (const e of src.ledger) if (e.orderId && ORDER_TYPES.has(e.type)) byOrder.set(e.orderId, [...(byOrder.get(e.orderId) ?? []), e]);
  const ticks = momentsOf(src).filter((x) => x <= now.getTime());
  let cur = ticks[0] ?? now.getTime();
  const mirror = new HistoryMirror({ store, writer, read: async () => sourcesAsOf(src, byOrder, cur), sessionClock: () => new Date(cur), now: () => new Date(cur), intervalMs: 0 });
  let writes = 0;
  for (let i = 0; i < ticks.length; i++) {
    cur = ticks[i];
    writes += (await mirror.sync()).writes.length;
    if (opts.log && i % 100 === 0) opts.log(`  ${i + 1} / ${ticks.length} moments, ${writes} writes`);
  }
  const report: BackfillReport = { ran: true, moments: ticks.length, writes, throughSeq: src.ledger.at(-1)?.seq ?? -1, ms: Math.round(performance.now() - t0), at: now.toISOString() };
  await store.setMeta(BACKFILL_KEY, JSON.stringify(report));
  return report;
}
