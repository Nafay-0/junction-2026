import { DockError, type PublicOrder } from "@/core/orders";
import type { RecordStore } from "@/server/records";
import type { Runtime } from "@/server/runtime";
import { sampleNow } from "@/server/alive/clock";

/**
 * The wholesaler's team confirms an order for delivery, or says it cannot be delivered. The partner has no order API:
 * an order is produced for human approval (docs/assumptions.md, Orders). This is that approval on the wholesaler's
 * side: a record ON TOP of a committed order. The gate, the signed quote, the price and the receipt do not change;
 * an order nobody confirms behaves exactly as before. Each decision is a ledger entry naming the staff member, a step
 * on the order's timeline, a mail to the kitchen's confirmed address (notify), and a line in the kitchen's
 * conversation (thread/fulfilment.ts).
 */

export type FulfilmentState = "waiting" | "confirmed" | "refused";
export type Fulfilment = { orderId: string; orgId: string; state: Exclude<FulfilmentState, "waiting">; at: string; by: string; reason?: string; sample?: boolean };

type Store = { map: Map<string, Fulfilment>; records?: RecordStore<Fulfilment>; ready: Promise<void> };
const g = globalThis as typeof globalThis & { __dockFulfilment?: WeakMap<object, Store> };

function storeOf(rt: Runtime): Store {
  g.__dockFulfilment ??= new WeakMap();
  let s = g.__dockFulfilment.get(rt);
  if (!s) {
    const records = rt.records<Fulfilment>("order_fulfilment");
    const map = new Map<string, Fulfilment>();
    s = { map, records, ready: records.list().then((xs) => xs.forEach((x) => map.set(x.orderId, x)), () => undefined) };
    g.__dockFulfilment.set(rt, s);
  }
  return s;
}

/** The wholesaler's side of a committed order: waiting, confirmed or refused; undefined for an order not placed. */
export async function fulfilmentOf(rt: Runtime, order: Pick<PublicOrder, "orderId" | "status">): Promise<{ state: FulfilmentState; at?: string; by?: string; reason?: string } | undefined> {
  if (order.status !== "committed") return undefined;
  const s = storeOf(rt);
  await s.ready;
  const f = s.map.get(order.orderId);
  return f ? { state: f.state, at: f.at, by: f.by, ...(f.reason ? { reason: f.reason } : {}) } : { state: "waiting" };
}

/** Every decision so far (for the operations list's counts). */
export async function fulfilments(rt: Runtime): Promise<Map<string, Fulfilment>> {
  const s = storeOf(rt);
  await s.ready;
  return s.map;
}

const ago = (d: Date) => d.toISOString();

/**
 * Staff decide: "confirm" (for delivery) or "refuse" (cannot deliver, with a short reason). Only a committed order;
 * once only (a second decision is refused, 409). Returns the record.
 */
export async function decideFulfilment(rt: Runtime, order: PublicOrder, input: { decision: "confirm" | "refuse"; by: string; reason?: string; sample?: boolean; now?: Date }): Promise<Fulfilment> {
  if (order.status !== "committed") throw new DockError(409, "order_not_placed", "Only a placed order is confirmed for delivery.");
  const reason = input.reason?.trim().slice(0, 300);
  if (input.decision === "refuse" && !reason) throw new DockError(400, "reason_required", "Say in a few words why it cannot be delivered.");
  const s = storeOf(rt);
  await s.ready;
  if (s.map.has(order.orderId)) throw new DockError(409, "already_decided", "This order was already confirmed or refused.");
  const f: Fulfilment = { orderId: order.orderId, orgId: order.orgId, state: input.decision === "confirm" ? "confirmed" : "refused", at: ago(input.now ?? sampleNow()), by: input.by.trim().slice(0, 80) || "Staff", ...(reason ? { reason } : {}), ...(input.sample ? { sample: true } : {}) };
  s.map.set(order.orderId, f);
  await s.records?.put(order.orderId, f).catch(() => undefined);
  rt.dock.ledger.append({
    type: "order",
    actor: `staff:${f.by}`,
    orderId: order.orderId,
    requestId: order.requestId,
    summary: f.state === "confirmed" ? `${f.by} of the wholesaler's team confirmed order ${order.orderId} for delivery, at the fixed price.` : `${f.by} of the wholesaler's team could not confirm order ${order.orderId} for delivery: ${f.reason}.`,
    data: { step: "fulfilment", decision: f.state, by: f.by, ...(f.reason ? { reason: f.reason } : {}) },
  });
  // The kitchen hears it: by mail when it has a confirmed address, and in its conversation.
  const { mailFulfilment } = await import("@/server/notify/service");
  await mailFulfilment(rt, order, f.state === "confirmed" ? "confirmed" : "not_confirmed", { by: f.by, ...(f.reason ? { reason: f.reason } : {}) }).catch((err) => console.error("[fulfilment] mail", err));
  const { sayFulfilment } = await import("@/server/thread/fulfilment");
  await sayFulfilment(rt, order, f).catch((err) => console.error("[fulfilment] thread", err));
  return f;
}
