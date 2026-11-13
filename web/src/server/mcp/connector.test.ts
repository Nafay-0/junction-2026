import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as connectorRoute from "@/app/api/mcp/c/[token]/route";
import * as approvalRoute from "@/app/api/v1/approvals/[approvalId]/route";
import * as connectRoute from "@/app/ui-api/connect/[kitchen]/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { LIVE_LOOKUP_LIMITS } from "@/core/live-allowance";
import { KITCHEN_ORG } from "../demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { doorLog } from "../ops/door";
import { suspensions } from "../ops/suspensions";
import { getRuntime, resetRuntime } from "../runtime";
import { CONNECTOR_LIMITS, ConnectorLimiter, ConnectorService, type ConnectorKitchen } from "./connectors";
import { connectorsFor } from "./server";

/**
 * Connector addresses: a stock MCP client given nothing but a URL. Every request goes to the real route handler
 * in-process. The kitchen is Ravintola Kaari (demo kitchen, returning, per-order limit €100, weekly budget €1,500).
 */
const BASE = "http://dock.test";
type Ctx<P> = { params: Promise<P> };
const tokenOf = (url: string | URL) => new URL(url).pathname.split("/").pop()!;
const inProcess = async (url: string | URL, init?: RequestInit) => {
  const req = new Request(url, init);
  const ctx: Ctx<{ token: string }> = { params: Promise.resolve({ token: tokenOf(url) }) };
  const handler = connectorRoute[req.method as "GET" | "POST" | "DELETE"];
  return handler(req, ctx as never);
};

async function connect(url: string, headers: Record<string, string> = {}, era: "modern" | "legacy" = "legacy") {
  const client = new Client({ name: "chat-assistant", version: "0.0.0" }, era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: inProcess, requestInit: { headers: { "user-agent": "Claude-User/1.0", ...headers } } }));
  await client.listTools(); // the client then checks every result against the published output schema
  return client;
}

type Structured = { ok: boolean; error?: { code: string; rule?: string; message: string; details?: Record<string, unknown> }; nextStep: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { isError: r.isError ?? false, s: r.structuredContent as Structured };
}

const connect$ = (slug: string, method: "GET" | "POST" | "DELETE" = "GET", headers: Record<string, string> = {}) =>
  connectRoute[method](new Request(`${BASE}/ui-api/connect/${slug}`, { method, headers }), { params: Promise.resolve({ kitchen: slug }) } as never);

async function addressOf(slug = "kaari"): Promise<string> {
  const r = await connect$(slug);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { connector: { url: string } };
  return body.connector.url;
}

const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const milk = (amount = 1000) => ({ need: { text: `${amount} L lactose-free milk`, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount, unit: "L" }, deliverBy: day() } });

/** Through a connector, as a chat assistant would: relaying the buyer's answers without knowing their name. */
async function orderToSignOff(client: Client) {
  const opened = await call(client, "submit_need", milk());
  expect(opened.s).toMatchObject({ ok: true, waitingFor: "buyer", step: { state: "needs_confirmation" } });
  const { requestId, concerns } = opened.s.step;
  let r = await call(client, "respond_to_concerns", { requestId, responses: concerns.map((c: { key: string }) => ({ key: c.key, choice: "confirm" })) });
  if (r.s.step.state === "needs_input") {
    r = await call(client, "answer_questions", { requestId, answers: r.s.step.questions.map((q: { id: string; options: { id: string }[] }) => ({ questionId: q.id, optionId: q.options[0].id })) });
  }
  expect(r.s.step.state).toBe("options_ready");
  const quoted = await call(client, "choose_option", { requestId, optionId: r.s.step.options[0].optionId });
  expect(quoted.s.step.state).toBe("quoted");
  // As a chat assistant should: only the requestId, so a long signed token is never copied by the model.
  const placed = await call(client, "place_order", { requestId });
  return { requestId, placed, example: quoted.s.step.next.example };
}

beforeEach(() => {
  resetRuntime();
  delete process.env.DOCK_CONNECTOR_SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.DOCK_CONNECTOR_SECRET;
});

describe("connector address: binding", () => {
  it("is a URL that carries the kitchen's own mandate and agent id, and ignores any headers sent with it", async () => {
    const url = await addressOf("kaari");
    expect(url).toMatch(/^http:\/\/dock\.test\/api\/mcp\/c\/dk_[A-Za-z0-9_-]{43}$/);

    // Someone else's valid mandate in the headers changes nothing: the address decides who is calling.
    const laakso = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
    const client = await connect(url, { authorization: `Bearer ${laakso}`, "dock-agent-id": DEMO_ORG.agentId });
    const { s } = await call(client, "read_mandate");
    expect(s).toMatchObject({ ok: true, mandate: { agentId: KITCHEN_ORG.agentId, issuer: { orgId: KITCHEN_ORG.orgId } } });

    // Same address on the next request for it (stable for the portal), works on the 2026-07-28 protocol too.
    expect(await addressOf("kaari")).toBe(url);
    const modern = await connect(url, {}, "modern");
    expect((await call(modern, "read_mandate")).s.mandate.agentId).toBe(KITCHEN_ORG.agentId);
  });

  it("records in the ledger that a request came through the connector, and from which assistant", async () => {
    const client = await connect(await addressOf("kaari"));
    const { s } = await call(client, "submit_need", milk(100));
    const { dock } = await getRuntime();
    const channel = dock.ledger.entries({ requestId: s.step.requestId }).find((e) => e.data.step === "channel")!;
    expect(channel).toMatchObject({ type: "intake", actor: `agent:${KITCHEN_ORG.agentId}`, data: { via: "connector", kitchen: "kaari", client: expect.stringMatching(/^Claude/) } });
    expect(channel.summary).toMatch(/connector address \(con_[0-9a-f]{12}\)/);
    expect(dock.ledger.verify().ok).toBe(true);
  });

  it("refuses an unknown address with 404, never 401 (a 401 would make Claude and ChatGPT start an OAuth sign-in)", async () => {
    for (const token of ["nope", `dk_${"A".repeat(43)}`]) {
      const res = await inProcess(`${BASE}/api/mcp/c/${token}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(res.status).toBe(404);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/no Dock connector at this address/);
    }
  });
});

describe("connector address: same gate, nothing more", () => {
  it("runs the milk order to the sign-off step, and the address cannot approve it", async () => {
    const url = await addressOf("kaari");
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.some((t) => /approv|sign.?off|decide/i.test(t.name))).toBe(false);

    const { requestId, placed, example } = await orderToSignOff(client);
    expect(placed.s).toMatchObject({ ok: true, order: { status: "pending_approval" } });
    const approver = placed.s.order.approval.approver.name as string;
    expect(["Sanna Koskinen", "Jari Mäkelä"]).toContain(approver); // the head chef, or the owner above €1,000
    expect(placed.s.nextStep).toMatch(new RegExp(`${approver}.*own phone.*Tell the buyer.*Do not retry`));

    // The buyer's answers are recorded as the person behind the connector, not as the agent.
    const { dock, outbox } = await getRuntime();
    const confirmation = dock.ledger.entries({ requestId }).find((e) => e.data.step === "confirmation")!;
    expect(confirmation.actor).toMatch(/^buyer:Kitchen staff at Ravintola Kaari, through the kitchen's connector/);

    // Presenting the connector token as an approval proof is refused; the order still waits for the approver.
    const { approvalId } = outbox.messages().find((m) => m.orderId === placed.s.order.orderId)!;
    const res = await approvalRoute.POST(
      new Request(`${BASE}/api/v1/approvals/${approvalId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", token: tokenOf(url) }) }),
      { params: Promise.resolve({ approvalId }) } as never,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await call(client, "get_order", { orderId: placed.s.order.orderId })).s.order.status).toBe("pending_approval");

    // A retry of the same order is refused by rule, whichever way it is sent.
    expect((await call(client, "place_order", example)).s.error).toMatchObject({ rule: "quote_replay" });
    expect((await call(client, "place_order", { requestId })).s.error).toMatchObject({ rule: "quote_replay" });
    // Without a chosen quote, the short form is refused with a reason.
    const { s: bare } = await call(client, "open_request", { text: "milk" });
    expect((await call(client, "place_order", { requestId: bare.request.requestId })).s.error).toMatchObject({ code: "invalid_request" });
  });

  it("cannot exceed the mandate: the weekly budget refuses, whatever the address", async () => {
    const client = await connect(await addressOf("kaari"));
    const { s: opened } = await call(client, "open_request", { text: "a lot of milk" });
    const requestId = opened.request.requestId;
    const q = await call(client, "request_quote", { requestId, lines: [{ productId: "VA-1001", quantity: 1500 }] });
    expect(q.s.policyPreview).toMatchObject({ outcome: "reject" });
    const r = await call(client, "place_order", { requestId, quoteToken: q.s.quoteToken, lines: q.s.quote.lines.map(({ productId, quantity, unitPriceCents }: Record<string, unknown>) => ({ productId, quantity, unitPriceCents })) });
    expect(r).toMatchObject({ isError: true, s: { error: { code: "policy_rejected", rule: "weekly_budget" } } });
  });

  it("shares the per-agent live-lookup allowance with every other door of the same agent", async () => {
    const client = await connect(await addressOf("kaari"));
    const { s } = await call(client, "read_mandate");
    const { dock } = await getRuntime();
    expect(s.liveLookupBudget).toEqual(dock.liveAllowance.remaining(`${KITCHEN_ORG.orgId}:${KITCHEN_ORG.agentId}`));
    const { s: opened } = await call(client, "open_request", { text: "milk" });
    const fake = (n: number) => Array.from({ length: 10 }, (_, i) => `X-${n + i}`);
    const max = LIVE_LOOKUP_LIMITS.maxDistinctProducts;
    for (let n = 0; n < max; n += 10) await call(client, "check_availability", { requestId: opened.request.requestId, productIds: fake(n) });
    const over = await call(client, "check_availability", { requestId: opened.request.requestId, productIds: fake(max) });
    expect(over.s.error).toMatchObject({ code: "live_lookup_budget_exceeded", rule: "live_lookup_limit" });
  });
});

describe("connector address: the operations layer", () => {
  it("goes through the same door log and suspensions as every other door, without the secret in the log", async () => {
    const url = await addressOf("kaari");
    const client = await connect(url);
    expect((await call(client, "read_mandate")).s.ok).toBe(true);
    const { dock } = await getRuntime();
    const last = doorLog(dock).all().at(-1)!;
    expect(last).toMatchObject({ agentId: KITCHEN_ORG.agentId, via: "mcp", ok: true, path: expect.stringMatching(/^\/api\/mcp\/c\/con_[0-9a-f]{12}$/) });
    expect(JSON.stringify(doorLog(dock).all())).not.toContain(tokenOf(url));

    suspensions(dock).suspend({ scope: "agent", target: KITCHEN_ORG.agentId, label: "Kaari's agent", reason: "test", by: "ops" });
    const r = await call(client, "read_mandate");
    expect(r).toMatchObject({ isError: true, s: { error: { rule: "operator_suspension" } } });
  });
});

describe("connector address: revocation and expiry", () => {
  it("reissue stops the old address at once; revoke leaves none until one is issued", async () => {
    const old = await addressOf("kaari");
    const client = await connect(old);
    expect((await call(client, "read_mandate")).s.ok).toBe(true);

    const re = await connect$("kaari", "POST");
    const fresh = ((await re.json()) as { connector: { url: string } }).connector.url;
    expect(fresh).not.toBe(old);
    await expect(connect(old)).rejects.toThrow();
    const res = await inProcess(old, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/revoked/);
    expect((await call(await connect(fresh), "read_mandate")).s.ok).toBe(true);

    const del = await connect$("kaari", "DELETE");
    expect(((await del.json()) as { connector: unknown }).connector).toBeNull();
    expect(((await (await connect$("kaari")).json()) as { connector: unknown }).connector).toBeNull();
    await expect(connect(fresh)).rejects.toThrow();

    const { dock } = await getRuntime();
    expect(dock.ledger.entries().some((e) => e.type === "refusal" && e.data.code === "connector_revoked")).toBe(true);
  });

  it("a visitor kitchen's address expires with the kitchen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { sandboxes } = await getRuntime();
    const { sandbox } = await sandboxes.joinWithoutPasskey();
    const r = await connect$(sandbox.sandboxId);
    const body = (await r.json()) as { connector: { url: string; expiresAt: string }; setup: { assistants: { id: string; steps: string[] }[] } };
    expect(body.connector.expiresAt).toBe(sandbox.expiresAt);
    expect(body.setup.assistants.find((a) => a.id === "claude")!.steps.join(" ")).toMatch(/No sign-in/);
    const client = await connect(body.connector.url);
    expect((await call(client, "read_mandate")).s.mandate.agentId).toBe(sandbox.agentId);

    vi.setSystemTime(Date.parse(sandbox.expiresAt) + 1000);
    const res = await inProcess(body.connector.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("demo kitchens get the same address after a restart when DOCK_CONNECTOR_SECRET is set", async () => {
    process.env.DOCK_CONNECTOR_SECRET = "a-test-secret-that-is-long-enough";
    const first = await addressOf("kaari");
    resetRuntime(); // a restart: nothing remembered
    const client = await connect(first);
    expect((await call(client, "read_mandate")).s.mandate.agentId).toBe(KITCHEN_ORG.agentId);
    expect(await addressOf("kaari")).toBe(first);
    expect(await addressOf("laakso")).not.toBe(first);

    // With a secret configured, only the operator may change a demo kitchen's address.
    expect((await connect$("kaari", "POST")).status).toBe(403);
    expect((await connect$("kaari", "DELETE")).status).toBe(403);
    const op = await connect$("kaari", "POST", { authorization: "Bearer a-test-secret-that-is-long-enough" });
    expect(op.status).toBe(200);
    expect(((await op.json()) as { connector: { url: string } }).connector.url).not.toBe(first);
    await expect(connect(first)).rejects.toThrow();
  });

  it("only the visitor can change their own kitchen's address", async () => {
    const { sandboxes } = await getRuntime();
    const { sandbox, sessionToken } = await sandboxes.joinWithoutPasskey();
    expect((await connect$(sandbox.sandboxId, "POST")).status).toBe(403);
    const mine = await connect$(sandbox.sandboxId, "POST", { cookie: `dock_approver=${encodeURIComponent(sessionToken)}` });
    expect(mine.status).toBe(200);
  });
});

describe("connector address: rate limits", () => {
  it("caps orders per address, before they reach the gate or anyone's phone", async () => {
    const client = await connect(await addressOf("kaari"));
    const { s: opened } = await call(client, "open_request", { text: "milk" });
    const forged = { requestId: opened.request.requestId, quoteToken: "a.b.c", lines: [{ productId: "VA-1001", quantity: 1, unitPriceCents: 1 }] };
    for (let i = 0; i < CONNECTOR_LIMITS.orders.max; i++) expect((await call(client, "place_order", forged)).s.error?.rule).toBe("quote_signature");
    const over = await call(client, "place_order", forged);
    expect(over).toMatchObject({ isError: true, s: { error: { code: "connector_rate_limited", rule: "connector_rate_limit", details: { kind: "orders" } } } });
    expect(over.s.nextStep).toMatch(/Tell the buyer plainly and stop/);
    const { dock } = await getRuntime();
    expect(dock.ledger.entries().filter((e) => e.data.code === "connector_rate_limited")).toHaveLength(1);
  });

  it("caps HTTP requests per address with 429 and Retry-After", async () => {
    const url = await addressOf("kaari");
    const list = () => inProcess(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    for (let i = 0; i < CONNECTOR_LIMITS.http.max; i++) expect((await list()).status).toBe(200);
    const res = await list();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another kitchen's address is unaffected.
    expect((await connect(await addressOf("laakso"))) instanceof Client).toBe(true);
  });

  it("limiter: a sliding window per address and kind", () => {
    let t = Date.parse("2026-11-15T10:00:00Z");
    const lim = new ConnectorLimiter({ ...CONNECTOR_LIMITS, requests: { max: 2, windowMinutes: 60 } }, () => new Date(t));
    lim.hit("a", "requests");
    lim.hit("a", "requests");
    expect(() => lim.hit("a", "requests")).toThrow(/limit is 2/);
    lim.hit("b", "requests");
    t += 60 * 60_000 + 1;
    expect(() => lim.hit("a", "requests")).not.toThrow();
  });
});

describe("ConnectorService", () => {
  const kitchen = (slug: string, expiresAt?: string): ConnectorKitchen => ({ slug, kind: expiresAt ? "visitor" : "demo", name: slug, mandateToken: "m", agentId: "a", by: "x", expiresAt });

  it("binds, expires and revokes without a runtime", async () => {
    let t = Date.parse("2026-11-15T10:00:00Z");
    const kitchens = new Map([["k1", kitchen("k1", "2026-11-15T11:00:00Z")]]);
    const svc = new ConnectorService({ resolveKitchen: async (s) => kitchens.get(s), demoKitchens: [], now: () => new Date(t) });
    const c = (await svc.current("k1"))!;
    expect(await svc.resolve(c.token)).toMatchObject({ ok: true, kitchen: { slug: "k1" } });
    expect(await svc.current("nope")).toBeUndefined();
    t = Date.parse("2026-11-15T11:00:01Z");
    expect(await svc.resolve(c.token)).toMatchObject({ ok: false, reason: "expired" });
    t = Date.parse("2026-11-15T10:30:00Z");
    await svc.revoke("k1");
    expect(await svc.resolve(c.token)).toMatchObject({ ok: false, reason: "revoked" });
    expect(await svc.current("k1")).toBeNull();
    const again = (await svc.reissue("k1"))!;
    expect(again.token).not.toBe(c.token);
    expect(await svc.resolve(again.token)).toMatchObject({ ok: true });
  });

  it("the runtime's service is fresh after a reset", async () => {
    const a = connectorsFor(await getRuntime());
    resetRuntime();
    expect(connectorsFor(await getRuntime())).not.toBe(a);
  });
});

