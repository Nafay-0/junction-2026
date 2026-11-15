import { DockError, type PublicOrder } from "@/core/orders";
import type { LedgerEntry } from "@/core/ledger";
import { AIVEN_BUYER } from "@/server/aiven/showcase/buyer";
import { streamConfigured } from "@/server/aiven/showcase/stream";
import type { Runtime } from "@/server/runtime";
import { opsContext } from "./context";
import { buildOrderTimeline, decidedHow, SOURCE_TEXT, type OrderSource, type OrderTimeline, type Viewer } from "./order-timeline";
import { verifyPasted } from "./verify";

/**
 * Every order from every source, newest first, for /ops/orders, and one order's timeline for /ops/orders/<id>, for
 * the kitchen's own order page and for the API (GET /api/v1/orders/{id}/timeline, the MCP tool get_order_timeline).
 * The list reads one index of the ledger (rebuilt when the ledger grows), so it stays a single pass with thousands of
 * orders; the timeline reads only its order's entries.
 */

export type OrderRow = {
  orderId: string;
  requestId: string;
  at: string;
  orgId: string;
  orgName: string;
  agentId: string;
  agentLabel: string;
  source: OrderSource;
  sourceText: string;
  door?: string;
  what: string;
  lineCount: number;
  totalCents: number;
  deliveryDate?: string;
  decided: OrderTimeline["decided"];
  status: OrderTimeline["status"];
  statusWords: string;
  waitingSinceAt?: string;
  /** Set on the way out (server/alive marks.ts) when the order was played by the sample activity. */
  sample?: boolean;
  /** A placed order: with the wholesaler's team to confirm ("waiting"), confirmed or refused. */
  fulfilment?: "waiting" | "confirmed" | "refused";
};

export type OrdersFilter = { kitchen?: string; agent?: string; source?: string; status?: string; day?: string; q?: string; page?: number; size?: number };

export type OrdersPage = {
  at: string;
  total: number;
  page: number;
  pages: number;
  size: number;
  rows: OrderRow[];
  facets: { kitchens: { id: string; label: string; n: number }[]; agents: { id: string; label: string; n: number }[]; sources: { id: string; label: string; n: number }[]; statuses: { id: string; label: string; n: number }[] };
  /** Placed orders the wholesaler's team has not confirmed yet. */
  search?: { path: string; answer: string };
};

type LedgerIndex = { n: number; door: Map<string, string>; offerRequests: Set<string>; watch: Map<string, Set<string>>; presenter: Set<string>; replacedBy: Map<string, string> };
const g = globalThis as typeof globalThis & { __dockOrdersIndex?: LedgerIndex };

/** One pass over the ledger: what the list needs per order and per request. */
function indexOf(entries: readonly LedgerEntry[]): LedgerIndex {
  const c = g.__dockOrdersIndex;
  if (c && c.n === entries.length) return c;
  const ix: LedgerIndex = { n: entries.length, door: new Map(), offerRequests: new Set(), watch: new Map(), presenter: new Set(), replacedBy: new Map() };
  for (const e of entries) {
    if (e.type === "request" && e.requestId && typeof e.data.door === "string") ix.door.set(e.requestId, e.data.door);
    else if (e.type === "offer" && e.data.step === "accepted" && e.requestId) ix.offerRequests.add(e.requestId);
    else if (e.type === "watch" && e.orderId && typeof e.data.step === "string") {
      const s = ix.watch.get(e.orderId) ?? new Set<string>();
      s.add(e.data.step);
      ix.watch.set(e.orderId, s);
    } else if (e.type === "agent" && e.data.event === "presenter_order" && e.orderId) ix.presenter.add(e.orderId);
    else if (e.type === "order" && typeof e.data.replaces === "string" && e.orderId) ix.replacedBy.set(e.data.replaces, e.orderId);
  }
  g.__dockOrdersIndex = ix;
  return ix;
}

const DOOR_SOURCE: Record<string, OrderSource> = { typed: "conversation", voice: "voice", photo: "photo", menu: "menu", assistant: "assistant", store: "store", mcp: "mcp", rest: "rest", connector: "connector" };

function sourceFromIndex(o: PublicOrder, ix: LedgerIndex): OrderSource {
  const w = ix.watch.get(o.orderId);
  if (ix.presenter.has(o.orderId)) return "presenter";
  if (w?.has("backup_used")) return "backup";
  if (w?.has("decided")) return "watch_substitute";
  if (w?.has("renewal_placed")) return "watch_renewal";
  if (ix.offerRequests.has(o.requestId)) return "offer";
  if (o.agentId === AIVEN_BUYER.agentId) return "aiven_agent";
  return DOOR_SOURCE[ix.door.get(o.requestId) ?? ""] ?? "other";
}

const STATUS_LABEL: Record<OrderRow["status"], string> = { pending_approval: "Waiting for sign-off", committed: "Placed", rejected: "Refused", declined: "Declined", withdrawn: "Taken back", expired: "Expired", replaced: "Replaced" };

function rowOf(o: PublicOrder, ix: LedgerIndex, agentLabel: string): OrderRow {
  const source = sourceFromIndex(o, ix);
  const replacedBy = ix.replacedBy.get(o.orderId);
  const status: OrderRow["status"] = replacedBy ? "replaced" : o.status;
  const first = o.lines[0];
  const dates = [...new Set(o.lines.map((l) => l.deliveryDate))].sort();
  return {
    orderId: o.orderId,
    requestId: o.requestId,
    at: o.createdAt,
    orgId: o.orgId,
    orgName: o.orgName,
    agentId: o.agentId,
    agentLabel,
    source,
    sourceText: SOURCE_TEXT[source],
    ...(ix.door.get(o.requestId) ? { door: ix.door.get(o.requestId) } : {}),
    what: first ? `${first.quantity} × ${first.name}${o.lines.length > 1 ? ` and ${o.lines.length - 1} more` : ""}` : "no lines",
    lineCount: o.lines.length,
    totalCents: o.totalCents,
    ...(dates[0] ? { deliveryDate: dates[0] } : {}),
    decided: decidedHow(o),
    status,
    statusWords: replacedBy ? `Replaced by ${replacedBy}` : o.status === "pending_approval" ? `Waiting for ${o.approval?.approver.name ?? "a person"}` : STATUS_LABEL[o.status],
    ...(o.status === "pending_approval" && o.approval ? { waitingSinceAt: o.approval.requestedAt } : {}),
  };
}

const count = <T extends string>(rows: OrderRow[], key: (r: OrderRow) => T, label: (id: T, r: OrderRow) => string) => {
  const m = new Map<T, { id: T; label: string; n: number }>();
  for (const r of rows) {
    const k = key(r);
    const e = m.get(k) ?? { id: k, label: label(k, r), n: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};

export async function ordersPage(rt: Runtime, f: OrdersFilter = {}): Promise<OrdersPage> {
  const ctx = await opsContext(rt);
  const ix = indexOf(ctx.entries);
  const { fulfilments } = await import("@/server/fulfilment/service");
  const decided = await fulfilments(rt);
  // A placed order is with the wholesaler's team to confirm until they decide.
  const withFulfilment = (r: OrderRow): OrderRow => (r.status === "committed" ? { ...r, fulfilment: decided.get(r.orderId)?.state ?? "waiting", statusWords: decided.get(r.orderId)?.state === "confirmed" ? "Placed, confirmed for delivery" : decided.get(r.orderId)?.state === "refused" ? "Placed, could not be confirmed" : "Placed, waiting for the wholesaler's confirmation" } : r);
  const all = ctx.orders
    .map((o) => withFulfilment(rowOf(o, ix, ctx.agents.get(o.agentId)?.label ?? o.agentId)))
    .sort((a, b) => b.at.localeCompare(a.at) || b.orderId.localeCompare(a.orderId));
  let rows = all;
  let search: OrdersPage["search"];
  const q = f.q?.trim();
  if (q) {
    const needle = q.toLowerCase();
    const ids = new Set<string>();
    if (!/^(ord|req)_/.test(q)) {
      // The audit trail in words (OpenSearch, SQL or the ledger): the orders and requests its events name.
      try {
        const { auditSearch } = await import("./audit-search");
        const a = await auditSearch(rt, q);
        for (const h of a.hits) {
          if (h.orderId) ids.add(h.orderId);
          if (h.requestId) ids.add(h.requestId);
        }
        if (a.read.kinds.length || a.read.rules.length) search = { path: a.path, answer: a.answer };
      } catch {
        // the plain text match below still answers
      }
    }
    rows = rows.filter((r) => ids.has(r.orderId) || ids.has(r.requestId) || `${r.orderId} ${r.requestId} ${r.orgName} ${r.agentLabel} ${r.agentId} ${r.what} ${r.sourceText} ${r.statusWords} ${r.decided.words}`.toLowerCase().includes(needle));
  }
  if (f.kitchen) rows = rows.filter((r) => r.orgId === f.kitchen);
  if (f.agent) rows = rows.filter((r) => r.agentId === f.agent);
  if (f.source) rows = rows.filter((r) => r.source === f.source);
  if (f.status === "to_confirm") rows = rows.filter((r) => r.fulfilment === "waiting");
  else if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (f.day) rows = rows.filter((r) => r.at.slice(0, 10) === f.day || r.deliveryDate === f.day);
  const size = Math.max(10, Math.min(f.size ?? 50, 200));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(1, Math.min(f.page ?? 1, pages));
  return {
    at: new Date().toISOString(),
    total: rows.length,
    page,
    pages,
    size,
    rows: rows.slice((page - 1) * size, page * size),
    facets: {
      kitchens: count(all, (r) => r.orgId, (_, r) => r.orgName),
      agents: count(all, (r) => r.agentId, (_, r) => r.agentLabel),
      sources: count(all, (r) => r.source, (id) => SOURCE_TEXT[id]),
      statuses: [...count(all, (r) => r.status, (id) => STATUS_LABEL[id]), ...(() => {
        const n = all.filter((r) => r.fulfilment === "waiting").length;
        return n ? [{ id: "to_confirm" as OrderRow["status"], label: "Waiting for the wholesaler's confirmation", n }] : [];
      })()],
    },
    ...(search ? { search } : {}),
  };
}

export type Receipt = { present: boolean; ok?: boolean; kid?: string; problem?: string; anchor?: { seq: number; matches: boolean | null } };

export type OrderTimelineView = OrderTimeline & {
  receipt: Receipt;
  /** The wholesaler's team's confirmation for delivery (server/fulfilment): waiting, confirmed or refused; absent unless placed. */
  fulfilment?: { state: "waiting" | "confirmed" | "refused"; at?: string; by?: string; reason?: string };
  links: { trace: string; audit: string; conversation?: string; kafka: boolean };
};

/** The wholesaler's signature on the order's confirmation, checked here against its own published key. */
async function receiptOf(rt: Runtime, order: PublicOrder): Promise<Receipt> {
  if (!order.confirmation) return { present: false };
  const r = await verifyPasted(order.confirmation, { keys: [rt.dock.wholesalerPublicJwk as never] }, rt.dock.ledger.readonly());
  return r.ok ? { present: true, ok: true, kid: r.kid, ...(r.anchor ? { anchor: { seq: r.anchor.seq, matches: r.anchor.matches } } : {}) } : { present: true, ok: false, problem: r.problem };
}

/** One order's timeline for operations (the kitchen's private memory named, never shown). */
export async function opsOrderTimeline(rt: Runtime, orderId: string): Promise<OrderTimelineView> {
  const ctx = await opsContext(rt);
  const order = ctx.orderById.get(orderId);
  if (!order) throw new DockError(404, "order_not_found", `No order ${orderId} on this server.`);
  const t = buildOrderTimeline({ order, ledger: ctx.entries, viewer: "ops", names: ctx.names, catalogueSize: ctx.catalogueSize, agentLabel: (id) => ctx.agents.get(id)?.label });
  const conversation = (ctx.entries.find((e) => e.type === "agent" && e.requestId === order.requestId && (e.data.thread as { threadId?: string } | undefined)?.threadId)?.data.thread as { threadId?: string } | undefined)?.threadId;
  const { fulfilmentOf } = await import("@/server/fulfilment/service");
  const fulfilment = await fulfilmentOf(rt, order);
  return { ...t, receipt: await receiptOf(rt, order), ...(fulfilment ? { fulfilment } : {}), links: { trace: `/ops/trace/${order.requestId}`, audit: `/ops/audit/${order.orderId}`, ...(conversation ? { conversation: `/ops/conversation/${conversation}` } : {}), kafka: streamConfigured() } };
}

/** The same timeline for the order's own organisation (the kitchen, or an agent acting for it). */
export async function ownOrderTimeline(rt: Runtime, order: PublicOrder, viewer: Exclude<Viewer, "ops">): Promise<OrderTimeline & { receipt: Receipt; fulfilment?: OrderTimelineView["fulfilment"] }> {
  const t = buildOrderTimeline({ order, ledger: rt.dock.ledger.readonly(), viewer });
  const { fulfilmentOf } = await import("@/server/fulfilment/service");
  const fulfilment = await fulfilmentOf(rt, order);
  return { ...t, receipt: await receiptOf(rt, order), ...(fulfilment ? { fulfilment } : {}) };
}
