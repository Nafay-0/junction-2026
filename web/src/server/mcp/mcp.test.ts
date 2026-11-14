import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { signMandate } from "@/core/mandate";
import { generateEd25519KeyPair } from "@/core/keys";
import { addDays } from "@/core/util";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { getRuntime, resetRuntime } from "../runtime";
import { OrderSchema } from "../wire";
import { LIVE_LOOKUP_LIMITS } from "./live-lookup-guard";

/** A stock MCP client talking to the real /api/mcp route handler in-process (no server, no Dock client code). */
const BASE = "http://dock.test";
const inProcess = async (url: string | URL, init?: RequestInit) => mcpRoute(new Request(url, init));

type Era = "legacy" | "modern";
async function connect(headers: Record<string, string>, era: Era = "modern") {
  const client = new Client(
    { name: "test-agent", version: "0.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: inProcess, requestInit: { headers } }));
  return client;
}

let mandate: string;
const auth = (m = mandate, agent = DEMO_ORG.agentId) => ({ authorization: `Bearer ${m}`, "dock-agent-id": agent });

type Structured = { ok: boolean; error?: { code: string; rule?: string; message: string; details?: Record<string, unknown> }; nextStep: string } & Record<string, unknown>;
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { isError: r.isError ?? false, s: r.structuredContent as Structured, text: (r.content[0] as { text: string }).text };
}

beforeEach(async () => {
  resetRuntime();
  mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
});

describe("MCP server", () => {
  it("lists every tool with a description and JSON schemas, without a mandate", async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "read_mandate",
      "submit_need",
      "respond_to_concerns",
      "answer_questions",
      "choose_option",
      "get_intake_step",
      "read_kitchen_memory",
      "place_order",
      "get_order",
      "list_orders",
      "withdraw_order",
      "explain",
      "get_order_timeline",
      "find_products",
      "find_alternatives",
      "open_request",
      "search_products",
      "check_availability",
      "request_quote",
      "list_offers",
      "accept_offer",
      "decline_offer",
      "mute_offers",
      "watch_orders",
      "answer_watch",
      "set_auto_renew",
      "line_up_backup",
      "plan_seasonal_menu",
      "plan_event_menu",
      "order_menu",
    ]);
    expect(tools.some((t) => /approv|sign.?off|decide/i.test(t.name))).toBe(false); // an agent can never sign off its own order
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
      // No dialect keyword: MCP's default is 2020-12, and older validators (Gemini CLI 0.25) refuse unknown dialects.
      expect(JSON.stringify([t.inputSchema, t.outputSchema])).not.toContain("$schema");
    }
    const avail = tools.find((t) => t.name === "check_availability")!;
    expect((avail.inputSchema.properties as Record<string, { maxItems?: number }>).productIds.maxItems).toBe(10);
    expect(client.getInstructions()).toMatch(/Do not retry/);
  });

  for (const era of ["modern", "legacy"] as const) {
    it(`runs the milk order end to end (${era} protocol era)`, async () => {
      const client = await connect(auth(), era);
      expect(client.getNegotiatedProtocolVersion()).toBe(era === "modern" ? "2026-07-28" : "2025-11-25");
      await client.listTools(); // the client now validates every result against the tool's published output schema
      const { s: m } = await call(client, "read_mandate");
      expect(m).toMatchObject({ ok: true, mandate: { agentId: DEMO_ORG.agentId } });

      const { s: opened } = await call(client, "open_request", { text: "1,000 L lactose-free milk by Monday", neededBy: "2099-01-01" });
      const requestId = (opened.request as { requestId: string }).requestId;

      const { s: found } = await call(client, "search_products", { requestId, text: "milk", category: "milk", attributes: ["lactose_free", "fat_1_5"] });
      expect((found.products as unknown[]).length).toBeGreaterThan(3);
      expect((await getRuntime()).dock.stats().liveCalls).toBe(0);

      const { s: live } = await call(client, "check_availability", { requestId, productIds: ["VA-1010", "AR-2010"] });
      expect(live.offers).toHaveLength(2);

      const { s: q } = await call(client, "request_quote", {
        requestId,
        lines: [
          { productId: "VA-1010", quantity: 60 },
          { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
        ],
      });
      const quote = q.quote as { lines: { productId: string; quantity: number; unitPriceCents: number }[] };
      const lines = quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

      const placed = await call(client, "place_order", { requestId, quoteToken: q.quoteToken, lines });
      expect(placed.isError).toBe(false);
      const order = OrderSchema.parse(placed.s.order);
      expect(order.status).toBe("pending_approval");
      expect(placed.s.nextStep).toMatch(/waits for a human sign-off.*Do not retry/);

      // A retry of the same order is refused, by rule.
      const again = await call(client, "place_order", { requestId, quoteToken: q.quoteToken, lines });
      expect(again).toMatchObject({ isError: true, s: { ok: false, error: { code: "policy_rejected", rule: "quote_replay" } } });

      // The human signs off out of band (the agent never sees the token).
      const { dock, outbox } = await getRuntime();
      const msg = outbox.messages().find((x) => x.orderId === order.orderId)!;
      await dock.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token: new URL(msg.link, BASE).searchParams.get("token")! } });

      const { s: got } = await call(client, "get_order", { orderId: order.orderId });
      expect(got).toMatchObject({ ok: true, order: { status: "committed", confirmation: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) } });

      const { s: ex } = await call(client, "explain", { requestId });
      expect(ex).toMatchObject({ ok: true, verification: { ok: true } });
      expect((ex.explanation as string[]).join("\n")).toMatch(/Committed order/);
    });
  }

  it("surfaces gate refusals with the rule and a next step", async () => {
    const client = await connect(auth());
    const { s: opened } = await call(client, "open_request", { text: "oat drink" });
    const requestId = (opened.request as { requestId: string }).requestId;
    const { s: q } = await call(client, "request_quote", { requestId, lines: [{ productId: "PK-4001", quantity: 10 }] });
    expect(q.policyPreview).toMatchObject({ outcome: "reject" });
    const lines = [{ productId: "PK-4001", quantity: 10, unitPriceCents: (q.quote as { lines: { unitPriceCents: number }[] }).lines[0].unitPriceCents }];
    const r = await call(client, "place_order", { requestId, quoteToken: q.quoteToken, lines });
    expect(r).toMatchObject({ isError: true, s: { ok: false, error: { code: "policy_rejected", rule: "forbidden_allergens" }, order: { status: "rejected" } } });
    expect(r.s.nextStep).toMatch(/allergen/);
    expect(JSON.parse(r.text)).toEqual(r.s); // same content for clients that only read text

    // The demo kitchens' weekly budget is sized for a day of demos; a mandate with a €2,000 week shows the refusal.
    const tight = await connect(auth(await signMandate(demoMandate(new Date(), { weeklyBudgetCents: 200_000 }), await demoOrgKeyPair())));
    const budget = await call(tight, "request_quote", { requestId, lines: [{ productId: "VA-1001", quantity: 1500 }] });
    const big = await call(tight, "place_order", {
      requestId,
      quoteToken: budget.s.quoteToken,
      lines: [{ productId: "VA-1001", quantity: 1500, unitPriceCents: (budget.s.quote as { lines: { unitPriceCents: number }[] }).lines[0].unitPriceCents }],
    });
    expect(big.s.error).toMatchObject({ rule: "weekly_budget" });
    expect(big.s.nextStep).toMatch(/hard limit/);

    const short = await call(client, "request_quote", { requestId, lines: [{ productId: "VA-1010", quantity: 100 }] });
    expect(short).toMatchObject({ isError: true, s: { error: { code: "quote_insufficient_stock", rule: "quote_availability", details: { available: 60 } } } });

    const forged = await call(client, "place_order", { requestId, quoteToken: "a.b.c", lines });
    expect(forged.s.error).toMatchObject({ rule: "quote_signature" });

    const other = await call(client, "get_order", { orderId: "ord_nope" });
    expect(other.s.error).toMatchObject({ code: "order_not_found" });
  });

  it("refuses calls without a valid mandate, naming the rule, the same way REST does", async () => {
    const cases: [Record<string, string>, string, string][] = [
      [{}, "mandate_missing", "mandate_signature"],
      [{ authorization: `Bearer ${mandate.slice(0, -4)}AAAA`, "dock-agent-id": DEMO_ORG.agentId }, "mandate_signature_invalid", "mandate_signature"],
      [auth(await signMandate(demoMandate(new Date()), await generateEd25519KeyPair(DEMO_ORG.kid))), "mandate_signature_invalid", "mandate_signature"],
      [auth(await signMandate(demoMandate(new Date(), { validFrom: addDays(new Date(), -8).toISOString(), validUntil: addDays(new Date(), -1).toISOString() }), await demoOrgKeyPair())), "mandate_expired", "mandate_window"],
      [{ authorization: `Bearer ${mandate}` }, "agent_id_missing", "mandate_agent"],
      [auth(mandate, "agent_someone_else"), "mandate_agent_mismatch", "mandate_agent"],
    ];
    for (const [headers, code, rule] of cases) {
      const client = await connect(headers);
      const r = await call(client, "open_request", { text: "milk" });
      expect(r, code).toMatchObject({ isError: true, s: { ok: false, error: { code, rule } } });
      expect(r.s.nextStep).toMatch(/Do not retry/);
    }
    // Mandate tokens are also accepted with the REST scheme name.
    const client = await connect({ authorization: `Mandate ${mandate}`, "dock-agent-id": DEMO_ORG.agentId });
    expect((await call(client, "read_mandate")).s.ok).toBe(true);
  });

  it("keeps requests private to the agent that opened them", async () => {
    const mine = await connect(auth());
    const { s } = await call(mine, "open_request", { text: "milk" });
    const requestId = (s.request as { requestId: string }).requestId;
    const otherMandate = await signMandate(demoMandate(new Date(), { agentId: "agent_two" }), await demoOrgKeyPair());
    const theirs = await connect(auth(otherMandate, "agent_two"));
    expect((await call(theirs, "explain", { requestId })).s.error).toMatchObject({ code: "request_not_found" });
    expect((await call(theirs, "search_products", { requestId })).s.error).toMatchObject({ code: "request_not_found" });
  });
});

describe("live price/availability guard", () => {
  it("never sends more than 10 products per call to the live service", async () => {
    const client = await connect(auth());
    const { s } = await call(client, "open_request", { text: "milk" });
    const requestId = (s.request as { requestId: string }).requestId;
    const ids = ["VA-1010", "AR-2010", "VA-1001", "VA-1002", "VA-1035", "JP-3010", "AR-2015", "VA-1201", "VA-1110", "PK-4001", "VA-2301"];

    const r = await call(client, "check_availability", { requestId, productIds: ids });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/productIds/);

    expect((await getRuntime()).dock.stats()).toMatchObject({ liveCalls: 0, productsPriced: 0 });

    // A long basket is one quote: Dock prices it in calls of at most 10 products, each counted.
    const lines = ids.map((productId) => ({ productId, quantity: 1 }));
    const q = await call(client, "request_quote", { requestId, lines });
    expect(q.s.error?.rule).not.toBe("live_lookup_limit");
    expect((await getRuntime()).dock.stats()).toMatchObject({ liveCalls: 2, productsPriced: 11 });
  });

  it("stops an agent looping over the catalogue ten products at a time", async () => {
    const client = await connect(auth());
    const { s } = await call(client, "open_request", { text: "everything" });
    const requestId = (s.request as { requestId: string }).requestId;
    const fakeIds = (from: number) => Array.from({ length: 10 }, (_, i) => `X-${from + i}`); // unknown ids still reach the live service
    const max = LIVE_LOOKUP_LIMITS.maxDistinctProducts;
    for (let n = 0; n < max; n += 10) expect((await call(client, "check_availability", { requestId, productIds: fakeIds(n) })).isError).toBe(false);

    const over = await call(client, "check_availability", { requestId, productIds: fakeIds(max) });
    expect(over).toMatchObject({ isError: true, s: { error: { code: "live_lookup_budget_exceeded", rule: "live_lookup_limit" } } });
    const quoteOver = await call(client, "request_quote", { requestId, lines: [{ productId: "VA-1010", quantity: 1 }] });
    expect(quoteOver.s.error).toMatchObject({ rule: "live_lookup_limit" });

    // Opening another request does not reset it: the allowance is per agent.
    const { s: s2 } = await call(client, "open_request", { text: "again" });
    const again = await call(client, "check_availability", { requestId: (s2.request as { requestId: string }).requestId, productIds: ["VA-1010"] });
    expect(again.s.error).toMatchObject({ rule: "live_lookup_limit" });

    // Re-checking products already priced is allowed until the call cap.
    expect((await call(client, "check_availability", { requestId, productIds: fakeIds(0) })).isError).toBe(false);

    const { dock } = await getRuntime();
    expect(dock.stats().productsPriced).toBe(max); // the re-check was answered from the short-lived live cache: not counted
    expect(dock.ledger.entries({ requestId }).some((e) => e.type === "refusal" && e.data.rule === "live_lookup_limit")).toBe(true);
  });
});
