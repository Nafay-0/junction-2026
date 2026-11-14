import { attachConsoleContext } from "../console-context";
import { ONSITE_HOST } from "../ops/door";
import { localFetch } from "../local-transport";

/**
 * The kitchen's agent as the show drives it: plain code calling Dock's public REST API with the kitchen's signed
 * mandate, exactly as an outside agent would. The requests go through the real route handlers in this process
 * (`localFetch`), so every call is authenticated, checked for suspension, written to the door log as the on-site
 * door, and decided by the same gate. The show never calls the core directly for an order.
 *
 * Each run gets its own share of the agent's live-lookup allowance (the console-session mechanism), so one week
 * cannot use up another's, and the share is set in-process only.
 */
export type Send = (req: Request) => Promise<Response>;
export type Reply<T = Json> = { status: number; body: T & { error?: { code: string; rule?: string; message: string; details?: Json } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export type AgentCredentials = { mandateToken: string; agentId: string };

export class ShowAgent {
  constructor(
    private readonly creds: AgentCredentials,
    private readonly ctx: { kitchen: string; share: string },
    private readonly send: Send = localFetch,
  ) {}

  /** Same agent, presenting another (for example a forged) mandate. */
  withMandate(mandateToken: string, agentId = this.creds.agentId): ShowAgent {
    return new ShowAgent({ mandateToken, agentId }, this.ctx, this.send);
  }

  async call<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<Reply<T>> {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Mandate ${this.creds.mandateToken}`, "dock-agent-id": this.creds.agentId };
    if (body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`http://${ONSITE_HOST}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    attachConsoleContext(req, { kitchen: this.ctx.kitchen, session: this.ctx.share });
    const res = await this.send(req);
    let parsed: Json = {};
    try {
      parsed = (await res.json()) as Json;
    } catch {
      parsed = { error: { code: "not_json", message: `HTTP ${res.status} without a JSON body.` } };
    }
    return { status: res.status, body: parsed as Reply<T>["body"] };
  }

  intakeOpen(need: Json, by: string) {
    return this.call<{ step: Json }>("POST", "/api/v1/intake", { need, by });
  }
  concerns(requestId: string, by: string, responses: { key: string; choice: string }[]) {
    return this.call<{ step: Json }>("POST", `/api/v1/intake/${requestId}/concerns`, { by, responses });
  }
  answers(requestId: string, by: string, answers: { questionId: string; optionId: string }[]) {
    return this.call<{ step: Json }>("POST", `/api/v1/intake/${requestId}/answers`, { by, answers });
  }
  choose(requestId: string, by: string, optionId: string) {
    return this.call<{ step: Json }>("POST", `/api/v1/intake/${requestId}/choice`, { by, optionId });
  }
  openRequest(text: string, neededBy?: string, productIds?: string[]) {
    return this.call<{ request: Json }>("POST", "/api/v1/requests", { text, neededBy, ...(productIds?.length ? { productIds } : {}) });
  }
  availability(requestId: string, productIds: string[], deliveryDate?: string) {
    return this.call<{ offers: Json[]; unavailable?: Json[] }>("POST", "/api/v1/availability", { requestId, productIds, ...(deliveryDate ? { deliveryDate } : {}) });
  }
  quote(requestId: string, lines: { productId: string; quantity: number; substituteFor?: string }[]) {
    return this.call<{ quote: Json; quoteToken: string; policyPreview: Json }>("POST", "/api/v1/quotes", { requestId, lines });
  }
  placeOrder(requestId: string, quoteToken: string, lines: { productId: string; quantity: number; unitPriceCents: number }[]) {
    return this.call<{ order: Json }>("POST", "/api/v1/orders", { requestId, quoteToken, lines });
  }
  getOrder(orderId: string) {
    return this.call<{ order: Json }>("GET", `/api/v1/orders/${orderId}`);
  }
  withdraw(orderId: string, reason: string, by: string) {
    return this.call<{ order: Json }>("POST", `/api/v1/orders/${orderId}/withdraw`, { reason, by });
  }
  decide(approvalId: string, decision: "approve" | "decline", token: string) {
    return this.call<{ order: Json }>("POST", `/api/v1/approvals/${approvalId}`, { decision, token });
  }
  kitchen() {
    return this.call<{ kitchen: Json }>("GET", "/api/v1/kitchen");
  }
}

/** The lines of a quote, as an order must repeat them. */
export function orderLines(quote: Json): { productId: string; quantity: number; unitPriceCents: number }[] {
  return (quote.lines as Json[]).map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
}
