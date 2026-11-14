/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: replies are untyped JSON. */
/**
 * The order flow over HTTP, as a buyer and an approver go through it, plus the refusal checks that must hold
 * whatever a dependency does. driveIntake is adapted from the QA harness (origin/claude/qa web/qa/lib/intake.ts).
 */
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { Caller, Http, Reply, Visitor } from "./http";

export type Trace = { states: string[]; final?: any; quoteStep?: any; order?: any; ms: number; replies: Reply[]; firstError?: { status: number; code?: string; message?: string } };

/** The next delivery day (Mon..Fri) at least `minDays` ahead, in Helsinki. */
export function deliveryDay(minDays = 2, days = [1, 2, 3, 4, 5]): string {
  let d = addDaysIso(localNow(new Date()).date, minDays);
  while (!days.includes(isoWeekday(d))) d = addDaysIso(d, 1);
  return d;
}

export async function driveIntake(call: Caller, need: unknown, opts: { by?: string; placeOrder?: boolean; maxSteps?: number } = {}): Promise<Trace> {
  const by = opts.by ?? "deps test buyer";
  const t0 = Date.now();
  const t: Trace = { states: [], replies: [], ms: 0 };
  const note = (r: Reply) => {
    t.replies.push(r);
    if (!t.firstError && (r.status === 0 || r.status >= 400)) t.firstError = { status: r.status, code: r.body?.error?.code ?? r.error, message: r.body?.error?.message ?? (r.text ? `non-JSON body: ${r.text.replace(/\s+/g, " ").slice(0, 120)}` : undefined) };
  };
  let r = await call("POST", "/api/v1/intake", { need, by });
  note(r);
  for (let i = 0; i < (opts.maxSteps ?? 8); i++) {
    const step = r.body?.step;
    t.states.push(step?.state ?? `http_${r.status}${r.body?.error?.code ? `(${r.body.error.code})` : r.error ? `(${r.error})` : ""}`);
    if (!step) break;
    t.final = step;
    const base = `/api/v1/intake/${step.requestId}`;
    if (step.state === "needs_confirmation") {
      const responses = step.concerns.map((c: any) => ({ key: c.key, choice: c.confirmable ? "confirm" : (c.corrections?.find((x: any) => !x.cancel)?.id ?? c.corrections?.[0]?.id ?? "confirm") }));
      r = await call("POST", `${base}/concerns`, { by, responses });
    } else if (step.state === "needs_input") {
      r = await call("POST", `${base}/answers`, { by, answers: step.questions.map((q: any) => ({ questionId: q.id, optionId: q.options[0].id })) });
    } else if (step.state === "options_ready") {
      const pick = step.preselected ? step.options.find((c: any) => c.optionId === step.preselected.optionId) ?? step.options[0] : step.options[0];
      r = await call("POST", `${base}/choice`, { by, optionId: pick.optionId });
    } else if (step.state === "quoted") {
      t.quoteStep = step;
      if (opts.placeOrder === false) break;
      r = await call("POST", "/api/v1/orders", step.next.example);
      note(r);
      t.order = r.body?.order;
      t.states.push(t.order ? `order_${t.order.status}` : `order_http_${r.status}${r.body?.error?.code ? `(${r.body.error.code})` : r.error ? `(${r.error})` : ""}`);
      break;
    } else break;
    note(r);
  }
  t.ms = Date.now() - t0;
  return t;
}

/** One line the buyer would read: the final state and its first note or error. */
export function buyerSees(t: Trace): string {
  const last = t.states.at(-1) ?? "nothing";
  const note = t.final?.notes?.[0] ?? t.firstError?.message ?? "";
  return `${last}${note ? `: ${String(note).slice(0, 160)}` : ""}`;
}

/** Alter one field of a compact JWS payload, keeping the original signature. */
export function tamperJws(token: string, mutate: (payload: any) => void): string {
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  mutate(payload);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

export type RefusalCheck = { name: string; status: number; code?: string; refused: boolean; accepted: boolean };

/**
 * Misbehaviour attempts against a fresh quote: an edited price, lines that differ from the quote, and a second
 * use of the same quote after the real order. "accepted" = Dock answered 2xx with an order (that must never happen).
 */
/**
 * The order body exactly as the console sends it: the signed quote token and its lines. Since main 4f0e267 a
 * step's `next.example` is only `{ requestId }` (Dock places the quote it signed for the request), so the explicit
 * body is built from the step's quote; without it the tamper checks below would silently not run.
 */
export function explicitOrderBody(quoteStep: any): any {
  const example = quoteStep?.next?.example;
  if (example?.quoteToken) return example;
  const q = quoteStep?.quote;
  if (!q?.quoteToken) return undefined;
  return {
    requestId: quoteStep.requestId ?? example?.requestId,
    quoteToken: q.quoteToken,
    lines: (q.quote?.lines ?? []).map(({ productId, quantity, unitPriceCents }: any) => ({ productId, quantity, unitPriceCents })),
  };
}

export async function refusalChecks(call: Caller, quoteStep: any): Promise<RefusalCheck[]> {
  const example = explicitOrderBody(quoteStep);
  if (!example?.quoteToken) throw new Error("refusalChecks: no quote token in the quote step; the step's shape changed");
  const out: RefusalCheck[] = [];
  const judge = (name: string, r: Reply) => {
    const accepted = r.status >= 200 && r.status < 300 && !!r.body?.order;
    out.push({ name, status: r.status, code: r.body?.error?.code ?? r.error, refused: r.status >= 400 && r.status < 500, accepted });
  };
  const cheap = tamperJws(example.quoteToken, (p) => {
    const q = p.quote ?? p;
    for (const l of q.lines ?? []) l.unitPriceCents = 1;
    if (typeof q.totalCents === "number") q.totalCents = (q.lines ?? []).reduce((s: number, l: any) => s + (l.quantity ?? 1), 0);
  });
  judge("edited_price", await call("POST", "/api/v1/orders", { ...example, quoteToken: cheap, lines: example.lines.map((l: any) => ({ ...l, unitPriceCents: 1 })) }));
  judge("lines_differ", await call("POST", "/api/v1/orders", { ...example, lines: example.lines.map((l: any) => ({ ...l, quantity: l.quantity * 2 })) }));
  return out;
}

/** After the real order: the same quote again must be refused (a quote is used once). */
export async function reuseCheck(call: Caller, quoteStep: any): Promise<RefusalCheck | undefined> {
  const example = explicitOrderBody(quoteStep);
  if (!example?.quoteToken) return undefined;
  const r = await call("POST", "/api/v1/orders", example);
  return { name: "quote_reused", status: r.status, code: r.body?.error?.code ?? r.error, refused: r.status >= 400 && r.status < 500, accepted: r.status >= 200 && r.status < 300 && !!r.body?.order };
}

/** An agent tries to approve its own order (tap proof, session proof). */
export async function selfApproveChecks(agent: Http, approvalId: string): Promise<RefusalCheck[]> {
  const out: RefusalCheck[] = [];
  for (const proof of [{ kind: "demo_tap" }, { kind: "session" }]) {
    const r = await agent.post(`/api/v1/approvals/${approvalId}`, { decision: "approve", proof });
    out.push({ name: `self_approve_${proof.kind}`, status: r.status, code: r.body?.error?.code ?? r.error, refused: r.status >= 400 && r.status < 500, accepted: r.status >= 200 && r.status < 300 && r.body?.order?.status === "committed" });
  }
  return out;
}

export type ApproverView = { listStatus: number; listed: boolean; pageStatus: number; viewStatus: number; decideStatus?: number; decideCode?: string; orderStatus?: string; ms: number };

/** What the approver's phone does: the list behind /approver, the page /approve/<id>, its data, then the passkey sign-off. */
export async function approverFlow(v: Visitor, approvalId: string, decide?: "approve" | "decline", passkeyDecide?: (v: Visitor, id: string, d: "approve" | "decline") => Promise<Reply>): Promise<ApproverView> {
  const t0 = Date.now();
  const list = await v.http.get("/api/v1/approvals");
  const page = await v.http.raw("GET", `/approve/${approvalId}`, undefined, { accept: "text/html" });
  const view = await v.http.get(`/api/v1/approvals/${approvalId}`);
  const out: ApproverView = { listStatus: list.status, listed: (list.body?.approvals ?? []).some((a: any) => a.approvalId === approvalId), pageStatus: page.status, viewStatus: view.status, ms: 0 };
  if (decide && passkeyDecide) {
    const d = await passkeyDecide(v, approvalId, decide);
    out.decideStatus = d.status;
    out.decideCode = d.body?.error?.code ?? d.error;
    out.orderStatus = d.body?.order?.status;
  }
  out.ms = Date.now() - t0;
  return out;
}

export type LedgerView = { status: number; ok?: boolean; entries: number; orders: Map<string, string[]>; head?: any };

/** The ledger as the caller may read it, and every order id it mentions with the entry types per order. */
export async function ledgerView(call: Caller): Promise<LedgerView> {
  const r = await call("GET", "/api/v1/ledger");
  const orders = new Map<string, string[]>();
  for (const e of r.body?.entries ?? []) if (e.orderId) orders.set(e.orderId, [...(orders.get(e.orderId) ?? []), e.type]);
  return { status: r.status, ok: r.body?.verification?.ok, entries: (r.body?.entries ?? []).length, orders, head: r.body?.head };
}

/** Poll `probe` every `everyMs` until it returns true; seconds from start to the first true, or null on timeout. */
export async function secondsUntil(probe: () => Promise<boolean>, timeoutMs = 120_000, everyMs = 500): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await probe().catch(() => false)) return Math.round((Date.now() - t0) / 100) / 10;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null;
}
