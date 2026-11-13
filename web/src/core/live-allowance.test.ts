import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog, type Product } from "./catalog";
import { generateEd25519KeyPair } from "./keys";
import { Ledger } from "./ledger";
import { LiveLookupAllowance, liveLookupLimits, shareKeyOf } from "./live-allowance";
import { createTrustRegistry, signMandate } from "./mandate";
import { InMemoryDockRepository, createDock } from "./orders";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const ids = (from: number, n = 10) => Array.from({ length: n }, (_, i) => `X-${from + i}`);

describe("live-lookup allowance (F-SHARED-LIVE-ALLOWANCE)", () => {
  it("gives each console session its own share, under a ceiling for the agent and one for the day", () => {
    const a = new LiveLookupAllowance({ windowMinutes: 60, maxCalls: 2, maxDistinctProducts: 100, maxCallsPerAgent: 5, maxCallsPerDay: 7 }, () => NOW);
    const s = (n: number) => shareKeyOf("org_k", "agent_k", `console:s${n}`);
    a.reserve(s(1), ids(0));
    a.reserve(s(1), ids(0));
    expect(() => a.reserve(s(1), ids(0))).toThrow(/This console session already made 2 live .* Try again in about 60 min/);
    a.reserve(s(2), ids(0)); // another person at the same kitchen still has their own share
    a.reserve(s(2), ids(0));
    a.reserve(s(3), ids(0));
    expect(() => a.reserve(s(4), ids(0))).toThrow(/for everyone at the console together/);
    a.reserve(shareKeyOf("org_other", "agent_o"), ids(0));
    a.reserve(shareKeyOf("org_other", "agent_o"), ids(0));
    expect(() => a.reserve(shareKeyOf("org_third", "agent_t"), ids(0))).toThrow(expect.objectContaining({ code: "live_lookup_daily_limit", status: 429 }));
  });

  it("reads its limits from the environment, with defaults sized for menus and long baskets", () => {
    expect(liveLookupLimits({})).toEqual({ windowMinutes: 60, maxCalls: 60, maxDistinctProducts: 150, maxCallsPerAgent: 600, maxCallsPerDay: 3000 });
    expect(liveLookupLimits({ DOCK_LIVE_CALLS_PER_HOUR: "5", DOCK_LIVE_PRODUCTS_PER_HOUR: "40", DOCK_LIVE_CALLS_PER_DAY: "x" })).toMatchObject({ maxCalls: 5, maxDistinctProducts: 40, maxCallsPerDay: 3000 });
  });

  it("counts only lookups that reach the partner, and prices a long basket in calls of ten", async () => {
    const base = SEED_PRODUCTS.find((p) => p.id === "VA-1001")!;
    const many: Product[] = Array.from({ length: 35 }, (_, i) => ({ ...base, id: `MX-${100 + i}`, name: `${base.name} #${i}` }));
    const stock = Object.fromEntries(many.map((p) => [p.id, SEED_STOCK["VA-1001"]]));
    const catalog = new MeteredCatalog(new InMemoryCatalog([...SEED_PRODUCTS, ...many], { ...SEED_STOCK, ...stock }, () => NOW));
    const buyer = await generateEd25519KeyPair("k");
    const ledger = new Ledger(undefined, () => NOW);
    const dock = createDock({ catalog, repo: new InMemoryDockRepository(), ledger, trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]), wholesalerKey: await generateEd25519KeyPair("w"), notifier: new InMemoryOutbox(), now: () => NOW });
    const mandate = sampleMandate(NOW, { weeklyBudgetCents: 10_000_000, perOrderLimitCents: 10_000_000 });
    const session = await dock.authenticate(await signMandate(mandate, buyer), mandate.agentId);
    const req = await dock.openRequest(session, { text: "a week's basket" });

    await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["VA-1001", "VA-1002"] });
    await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["VA-1001", "VA-1002"] }); // from the cache
    expect(catalog.stats().liveCalls).toBe(1);
    expect(dock.liveAllowance.remaining("org_laakso:agent_buyer_1").callsLeft).toBe(59);

    // 35 lines: one quote, four partner calls of at most ten, one gate decision, one order.
    const lines = many.map((p) => ({ productId: p.id, quantity: 2 }));
    const q = await dock.requestQuote(session, { requestId: req.requestId, lines });
    expect(q.quote.lines).toHaveLength(35);
    expect(catalog.stats().liveCalls).toBe(5);
    expect(ledger.entries().filter((e) => e.type === "quote").at(-1)!.summary).toMatch(/and 23 more lines \(35 in all\)/);
    const order = await dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    expect(order.status).toBe("committed");
    expect(order.lines).toHaveLength(35);
    await expect(dock.requestQuote(session, { requestId: req.requestId, lines: Array.from({ length: 61 }, () => lines[0]) })).rejects.toMatchObject({ status: 400 });
  });
});
