/**
 * A thin HTTP client for Dock's v1 API, as an outside purchasing agent would use it.
 * `send` is either real `fetch` (against a running server) or the in-process router (no server needed).
 * It never throws on HTTP errors: refusals come back as data so the caller can show them.
 */
export type Send = (req: Request) => Promise<Response>;
export type Reply<T = Record<string, unknown>> = { status: number; body: T & { error?: { code: string; rule?: string; message: string } } };

export class DockClient {
  constructor(
    private readonly send: Send,
    private readonly baseUrl: string,
    private readonly mandate?: string,
    private readonly agentId?: string,
  ) {}

  as(mandate: string | undefined, agentId: string | undefined): DockClient {
    return new DockClient(this.send, this.baseUrl, mandate, agentId);
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown): Promise<Reply<T>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.mandate) headers.authorization = `Mandate ${this.mandate}`;
    if (this.agentId) headers["dock-agent-id"] = this.agentId;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.send(
      new Request(new URL(path, this.baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    return { status: res.status, body: (await res.json()) as Reply<T>["body"] };
  }

  openRequest(text: string, neededBy?: string) {
    return this.call<{ request: { requestId: string } }>("POST", "/api/v1/requests", { text, neededBy });
  }
  search(requestId: string, q: { q?: string; category?: string; attributes?: string[] }) {
    const p = new URLSearchParams({ requestId });
    if (q.q) p.set("q", q.q);
    if (q.category) p.set("category", q.category);
    for (const a of q.attributes ?? []) p.append("attribute", a);
    return this.call<{ products: Product[] }>("GET", `/api/v1/products?${p}`);
  }
  availability(requestId: string, productIds: string[]) {
    return this.call<{ offers: Offer[]; liveCallsSoFar: number }>("POST", "/api/v1/availability", { requestId, productIds });
  }
  quote(requestId: string, lines: { productId: string; quantity: number; substituteFor?: string }[]) {
    return this.call<{ quote: Quote; quoteToken: string; policyPreview: Decision }>("POST", "/api/v1/quotes", { requestId, lines });
  }
  placeOrder(requestId: string, quoteToken: string, lines: { productId: string; quantity: number; unitPriceCents: number }[]) {
    return this.call<{ order: Order }>("POST", "/api/v1/orders", { requestId, quoteToken, lines });
  }
  getOrder(orderId: string) {
    return this.call<{ order: Order }>("GET", `/api/v1/orders/${orderId}`);
  }
  pendingApprovals() {
    return this.call<{ approvals: { approvalId: string; orderId: string }[] }>("GET", "/api/v1/approvals");
  }
  decide(approvalId: string, decision: "approve" | "decline", token: string, note?: string) {
    return this.call<{ order: Order }>("POST", `/api/v1/approvals/${approvalId}`, { decision, token, note });
  }
  ledger(filter: { requestId?: string; orderId?: string } = {}) {
    const p = new URLSearchParams(filter as Record<string, string>);
    return this.call<{ verification: { ok: boolean }; catalog: { searches: number; liveCalls: number; productsPriced: number }; explanation: string[]; entries: unknown[] }>("GET", `/api/v1/ledger?${p}`);
  }
  keys() {
    return this.call<{ keys: Record<string, string>[] }>("GET", "/api/v1/keys");
  }
  outbox() {
    return this.call<{ messages: { approvalId: string; orderId: string; approver: { name: string; role: string }; link: string; reasons: string[] }[] }>(
      "GET",
      "/api/v1/dev/outbox",
    );
  }
}

// Wire shapes the demo reads (the server's types live in src/core).
export type Product = { id: string; name: string; packSize: number; unit: string; attributes: string[]; deliveryReliability: number; carbonKgPerUnit: number };
export type Offer = { productId: string; unitPriceCents: number; availablePacks: number; deliveryDate: string };
export type QuoteLine = { productId: string; name: string; quantity: number; unitPriceCents: number; lineTotalCents: number; deliveryDate: string; substituteFor?: { productId: string } };
export type Quote = { quoteId: string; lines: QuoteLine[]; totalCents: number; expiresAt: string };
export type Decision = { outcome: string; reasons: string[]; approver?: { name: string; role: string }; rules: { rule: string; outcome: string }[] };
export type Order = { orderId: string; status: string; totalCents: number; lines: QuoteLine[]; decision: Decision; confirmation?: string; approval?: { approvalId: string; status: string } };
