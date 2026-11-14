/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * Drive one intake through its states the way a scripted buyer would, recording every step, and check the
 * intake invariants on the way:
 *
 *   amounts      every option card delivers at least the amount asked, in litres/kg/pieces, and less than one
 *                extra pack of its largest line (or says it is partial / gives up the amount)
 *   money        card total = sum of packs x pack price; quote total = card total; order total = quote total
 *   commitment   the quote buys exactly the card's lines; the committed order buys exactly the quote's lines
 *   mandate      a committed order breaks no rule of the mandate (every rule passes or a person signed it)
 */
import type { Http, Reply } from "./http";

export type Step = any;
export type DriveOpts = {
  by?: string;
  /** What to answer at a confirmation: "confirm" when allowed, else the first correction (default), or stop. */
  onConcern?: "confirm" | "correct" | "stop";
  choose?: "first" | "preselected" | "cheapest";
  placeOrder?: boolean;
  maxSteps?: number;
};

export type Trace = { steps: { state: string; status: number; code?: string }[]; final?: Step; quote?: any; order?: any; problems: string[]; replies: Reply[] };

const sumLines = (lines: any[]) => lines.reduce((s, l) => s + (l.lineTotalCents ?? l.packs * l.unitPriceCents), 0);

export function checkCards(step: Step, problems: string[]) {
  const amount = step.amount;
  for (const c of step.options ?? []) {
    const lines = c.lines ?? [];
    const total = lines.reduce((s: number, l: any) => s + l.packs * l.unitPriceCents, 0);
    if (c.totalCents !== total) problems.push(`money: card ${c.optionId} total ${c.totalCents} != sum of packs x price ${total}`);
    if ((c.quoteLines ?? []).length !== lines.length) problems.push(`commitment: card ${c.optionId} shows ${lines.length} line(s) but would quote ${(c.quoteLines ?? []).length}`);
    for (const ql of c.quoteLines ?? []) {
      const shown = lines.find((l: any) => l.productId === ql.productId);
      if (!shown || shown.packs !== ql.quantity) problems.push(`commitment: card ${c.optionId} shows ${shown?.packs} x ${ql.productId} but would quote ${ql.quantity}`);
    }
    if (amount && amount.unit) {
      const delivered = lines.filter((l: any) => (l.unit ?? amount.unit) === amount.unit).reduce((s: number, l: any) => s + l.packs * (l.packSize ?? 0), 0);
      const biggest = Math.max(0, ...lines.map((l: any) => l.packSize ?? 0));
      const givesUpAmount = (c.givesUp ?? []).some((g: any) => /amount|quantity|partial/.test(g.part));
      if (delivered + 1e-9 < amount.amount && !givesUpAmount && c.match === "full") problems.push(`amount: card ${c.optionId} is a full match but delivers ${round(delivered)} ${amount.unit} of ${amount.amount} asked`);
      if (biggest > 0 && delivered - amount.amount >= biggest - 1e-9) problems.push(`amount: card ${c.optionId} delivers ${round(delivered)} ${amount.unit} for ${amount.amount} asked: a whole pack (${biggest}) too many`);
    }
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export async function driveIntake(call: (method: "GET" | "POST", path: string, body?: unknown) => Promise<Reply>, need: unknown, opts: DriveOpts = {}): Promise<Trace> {
  const by = opts.by ?? "QA buyer";
  const t: Trace = { steps: [], problems: [], replies: [] };
  let r = await call("POST", "/api/v1/intake", { need, by });
  t.replies.push(r);
  for (let i = 0; i < (opts.maxSteps ?? 6); i++) {
    const step = r.body?.step;
    t.steps.push({ state: step?.state ?? `http_${r.status}`, status: r.status, code: r.body?.error?.code });
    if (!step) return t;
    t.final = step;
    checkCards(step, t.problems);
    const base = `/api/v1/intake/${step.requestId}`;
    if (step.state === "needs_confirmation") {
      if (opts.onConcern === "stop") return t;
      const responses = step.concerns.map((c: any) => ({ key: c.key, choice: opts.onConcern === "confirm" && c.confirmable ? "confirm" : (c.corrections?.find((x: any) => !x.cancel)?.id ?? (c.confirmable ? "confirm" : c.corrections?.[0]?.id ?? "confirm")) }));
      r = await call("POST", `${base}/concerns`, { by, responses });
    } else if (step.state === "needs_input") {
      r = await call("POST", `${base}/answers`, { by, answers: step.questions.map((q: any) => ({ questionId: q.id, optionId: q.options[0].id })) });
    } else if (step.state === "options_ready") {
      const cards = step.options;
      const pick = opts.choose === "cheapest" ? [...cards].sort((a: any, b: any) => a.totalCents - b.totalCents)[0] : opts.choose === "preselected" && step.preselected ? cards.find((c: any) => c.optionId === step.preselected.optionId) : cards[0];
      r = await call("POST", `${base}/choice`, { by, optionId: pick.optionId });
      const chosen = r.body?.step;
      if (chosen?.quote) {
        const q = chosen.quote.quote;
        if (q.totalCents !== pick.totalCents) t.problems.push(`money: chose a €${pick.totalCents / 100} card, quote says €${q.totalCents / 100}`);
        for (const ql of pick.quoteLines) {
          const got = q.lines.find((l: any) => l.productId === ql.productId);
          if (!got || got.quantity !== ql.quantity) t.problems.push(`commitment: card line ${ql.quantity} x ${ql.productId}, quote ${got?.quantity ?? "none"}`);
        }
      }
    } else if (step.state === "quoted") {
      t.quote = step.quote;
      if (opts.placeOrder === false) return t;
      r = await call("POST", "/api/v1/orders", step.next.example);
      t.replies.push(r);
      t.order = r.body?.order;
      t.steps.push({ state: `order_${t.order?.status ?? r.status}`, status: r.status, code: r.body?.error?.code });
      if (t.order) {
        const q = step.quote.quote;
        if (t.order.totalCents !== q.totalCents) t.problems.push(`money: order total ${t.order.totalCents} != quote ${q.totalCents}`);
        if (sumLines(t.order.lines) !== t.order.totalCents) t.problems.push(`money: order lines ${sumLines(t.order.lines)} != order total ${t.order.totalCents}`);
        for (const l of t.order.lines) {
          const ql = q.lines.find((x: any) => x.productId === l.productId);
          if (!ql || ql.quantity !== l.quantity || ql.unitPriceCents !== l.unitPriceCents) t.problems.push(`commitment: order line ${l.quantity} x ${l.productId} differs from quote`);
        }
        if (t.order.status === "committed" && !t.order.approval) {
          const bad = (t.order.decision?.rules ?? []).filter((x: any) => x.outcome !== "pass");
          if (bad.length) t.problems.push(`mandate: committed without sign-off although ${bad.map((x: any) => `${x.rule}=${x.outcome}`).join(", ")}`);
        }
      }
      return t;
    } else return t;
    t.replies.push(r);
  }
  return t;
}
