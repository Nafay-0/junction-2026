/**
 * The demo path as one function: a visitor's kitchen asks for milk over its €500 limit through the console,
 * misbehaviour is tried on the quote, the order goes to the visitor's phone, the phone signs it with a passkey.
 * Each step is recorded, never thrown, so a scenario can run it while a dependency is failing.
 */
import { approverFlow, buyerSees, deliveryDay, driveIntake, ledgerView, refusalChecks, reuseCheck, selfApproveChecks, type ApproverView, type RefusalCheck, type Trace } from "./flow";
import { consoleCall, laaksoAgent, passkeyDecide, restCaller, type Http, type Visitor } from "./http";

export type Cycle = {
  trace: Trace;
  buyer: string;
  refusals: RefusalCheck[];
  orderId?: string;
  orderStatus?: string;
  approvalId?: string;
  approver?: ApproverView;
  refusalHeld: boolean;
  ms: number;
};

let seq = 0;

/** litres: vary it per call so nothing is answered from a cache keyed on the need. */
export async function visitorCycle(v: Visitor, opts: { litres?: number; approve?: boolean; deliverBy?: string } = {}): Promise<Cycle> {
  const t0 = Date.now();
  const call = consoleCall(v.http, v.sandboxId);
  const litres = opts.litres ?? 1000 + (seq++ % 50);
  const trace = await driveIntake(call, { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: litres, unit: "L" }, deliverBy: opts.deliverBy ?? deliveryDay() }, { placeOrder: false });
  const out: Cycle = { trace, buyer: buyerSees(trace), refusals: [], refusalHeld: true, ms: 0 };
  if (trace.quoteStep) {
    out.refusals.push(...(await refusalChecks(call, trace.quoteStep)));
    const o = await call("POST", "/api/v1/orders", trace.quoteStep.next.example);
    out.orderId = o.body?.order?.orderId;
    out.orderStatus = o.body?.order?.status ?? `http_${o.status}${o.body?.error?.code ? `(${o.body.error.code})` : o.error ? `(${o.error})` : ""}`;
    out.approvalId = o.body?.order?.approval?.approvalId;
    out.buyer = `order ${out.orderStatus}`;
    const reuse = await reuseCheck(call, trace.quoteStep);
    if (reuse) out.refusals.push(reuse);
    const total = o.body?.order?.totalCents ?? 0;
    // over the €500 visitor limit, the order must wait for a person
    if (o.body?.order && total > 50_000 && o.body.order.status === "committed" && !o.body.order.approval) out.refusalHeld = false;
    if (out.approvalId && opts.approve !== false) {
      out.approver = await approverFlow(v, out.approvalId, "approve", passkeyDecide);
    }
  }
  if (out.refusals.some((r) => r.accepted)) out.refusalHeld = false;
  out.ms = Date.now() - t0;
  return out;
}

/** The same over REST as the demo buyer organisation's agent, plus the agent trying to approve its own order. */
export async function restCycle(http: Http): Promise<Cycle & { selfApprove: RefusalCheck[] }> {
  const t0 = Date.now();
  const a = await laaksoAgent(http);
  const call = restCaller(a);
  const trace = await driveIntake(call, { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000 + (seq++ % 50), unit: "L" }, deliverBy: deliveryDay() }, { placeOrder: false });
  const out: Cycle & { selfApprove: RefusalCheck[] } = { trace, buyer: buyerSees(trace), refusals: [], refusalHeld: true, ms: 0, selfApprove: [] };
  if (trace.quoteStep) {
    out.refusals.push(...(await refusalChecks(call, trace.quoteStep)));
    const o = await call("POST", "/api/v1/orders", trace.quoteStep.next.example);
    out.orderId = o.body?.order?.orderId;
    out.orderStatus = o.body?.order?.status ?? `http_${o.status}${o.body?.error?.code ? `(${o.body.error.code})` : ""}`;
    out.approvalId = o.body?.order?.approval?.approvalId;
    out.buyer = `order ${out.orderStatus}`;
    if (out.approvalId) out.selfApprove = await selfApproveChecks(a, out.approvalId);
  }
  if ([...out.refusals, ...out.selfApprove].some((r) => r.accepted)) out.refusalHeld = false;
  out.ms = Date.now() - t0;
  return out;
}

/** Every order the visitor's ledger names, with its entry types; flags an order committed twice or a missing order. */
export async function orderAudit(v: Visitor, expected: string[]): Promise<{ ledgerOk?: boolean; lostOrDup: string; committedTwice: string[]; missing: string[]; entries: number }> {
  const call = consoleCall(v.http, v.sandboxId);
  const l = await ledgerView(call);
  const committedTwice = [...l.orders.entries()].filter(([, types]) => types.filter((t) => t === "order").length > 1 || types.filter((t) => t === "approval").length > 1).map(([id]) => id);
  const missing = expected.filter((id) => !l.orders.has(id));
  const statusChecks = await Promise.all(expected.map(async (id) => ({ id, r: await call("GET", `/api/v1/orders/${id}`) })));
  const notFound = statusChecks.filter((s) => s.r.status === 404).map((s) => s.id);
  const parts: string[] = [];
  if (committedTwice.length) parts.push(`duplicated: ${committedTwice.join(", ")}`);
  if (missing.length) parts.push(`missing from ledger: ${missing.join(", ")}`);
  if (notFound.length) parts.push(`order not found: ${notFound.join(", ")}`);
  if (l.status !== 200) parts.push(`ledger read ${l.status}`);
  return { ledgerOk: l.ok, lostOrDup: parts.length ? parts.join("; ") : "none", committedTwice, missing: [...missing, ...notFound], entries: l.entries };
}

export function approverSees(a?: ApproverView): string {
  if (!a) return "no sign-off asked";
  const listed = a.listed ? "listed" : `not listed (${a.listStatus})`;
  return `${listed}, page ${a.pageStatus}, view ${a.viewStatus}${a.decideStatus !== undefined ? `, sign-off ${a.decideStatus}${a.decideCode ? `(${a.decideCode})` : ""} -> ${a.orderStatus ?? "?"}` : ""}`;
}
