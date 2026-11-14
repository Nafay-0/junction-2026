/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/** Small steps of the order flow over REST, shared by probes. Every helper returns the raw reply. */
import type { Http, Reply } from "./http";

export async function openRequest(a: Http, text = "qa probe", neededBy?: string): Promise<string> {
  const r = await a.post("/api/v1/requests", { text, ...(neededBy ? { neededBy } : {}) });
  const id = r.body?.request?.requestId;
  if (!id) throw new Error(`open request failed: ${r.status} ${r.text.slice(0, 200)}`);
  return id;
}

export type QuoteLineIn = { productId: string; quantity: number; substituteFor?: string };

export async function quote(a: Http, requestId: string, lines: QuoteLineIn[]): Promise<Reply> {
  return a.post("/api/v1/quotes", { requestId, lines });
}

export function linesOf(q: Reply): { productId: string; quantity: number; unitPriceCents: number }[] {
  return (q.body?.quote?.lines ?? []).map((l: { productId: string; quantity: number; unitPriceCents: number }) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
}

export async function order(a: Http, requestId: string, q: Reply, lines = linesOf(q)): Promise<Reply> {
  return a.post("/api/v1/orders", { requestId, quoteToken: q.body?.quoteToken, lines });
}

/** Quote and order in one go. */
export async function buy(a: Http, lines: QuoteLineIn[], opts: { text?: string; neededBy?: string } = {}) {
  const requestId = await openRequest(a, opts.text, opts.neededBy);
  const q = await quote(a, requestId, lines);
  const o = q.status >= 200 && q.status < 300 ? await order(a, requestId, q) : undefined;
  return { requestId, q, o };
}

/** Weekly spend Dock currently counts for the agent's organisation, read from a quote's policy preview. */
export function spentFromPreview(q: Reply): number | undefined {
  const r = (q.body?.policyPreview?.rules ?? []).find((x: { rule: string }) => x.rule === "weekly_budget");
  return r?.details?.spentCents;
}

export function ruleOutcome(decision: { rules?: { rule: string; outcome: string }[] } | undefined, rule: string): string | undefined {
  return decision?.rules?.find((r) => r.rule === rule)?.outcome;
}

/** Alter one field of a compact JWS payload, keeping the original signature. */
export function tamperJws(token: string, mutate: (payload: any) => void): string {
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  mutate(payload);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

export async function ledgerOk(http: Http): Promise<{ ok: boolean; entries: any[]; body: any }> {
  const r = await http.get("/api/v1/ledger");
  return { ok: r.body?.verification?.ok === true, entries: r.body?.entries ?? [], body: r.body };
}
