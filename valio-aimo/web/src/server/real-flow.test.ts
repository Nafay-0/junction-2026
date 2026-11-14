// The partner's own example on the real catalogue's shape: a fixture index built from synthetic records shaped like
// the partner's product file, and a fake of its price/availability API returning the documented responses. No
// partner data, no network.
import { base64url } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutbox } from "@/core/approval";
import { MeteredCatalog } from "@/core/catalog";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import { auditFor } from "@/core/audit";
import { verifyClaim } from "@/core/claims";
import { InMemoryKitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair, type KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { LiveLookupAllowance } from "@/core/live-allowance";
import { createTrustRegistry, signMandate } from "@/core/mandate";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock } from "@/core/orders";
import { sampleMandate } from "@/core/test-fixtures";
import { sha256Hex } from "@/core/util";
import { fakeValioApi, type FakeScenario } from "./valio/fake-api";
import { ValioLiveClient } from "./valio/live-client";
import { ValioCatalog } from "./valio/valio-catalog";

const NOW = new Date("2026-11-13T20:00:00.000Z"); // Friday 22:00 in Helsinki
const MONDAY = "2026-11-16";
const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV, NOW);

// What the partner's API said for Monday tonight: the 10 l boxes ship from a supplier and their cut-off passed on
// Thursday; 1 l cartons are stock items, cut-off Sunday 17:00. Amounts are placeholders.
const SCENARIOS: Record<string, FakeScenario> = {
  "900001": { price: 31.31, logisticModel: "Terminal", closingTime: "2026-11-12T15:00:00+0200", date: MONDAY, unit: "KI", validTo: "9999-12-31T00:00:00+0200" },
  "900002": { price: 1.4, amount: 9999999999, closingTime: "2026-11-15T17:00:00+0200", date: MONDAY, unit: "ST", validTo: "2026-12-31T00:00:00+0200" },
  "900003": { price: 18.2, amount: 9999999999, closingTime: "2026-11-15T17:00:00+0200", date: MONDAY, unit: "KI" },
};

let dock: Dock;
let session: AgentSession;
let wholesaler: KeyPair;
let api: ReturnType<typeof fakeValioApi>;
let ledger: Ledger;

async function setup(opts: { status?: number; allowance?: LiveLookupAllowance } = {}) {
  api = fakeValioApi(SCENARIOS, { timeNow: "2026-11-13T22:00:00+0200", status: opts.status });
  const live = new ValioLiveClient({ baseUrl: "http://valio.test", apiKey: "test-key", fetch: api.fetch, now: () => NOW, sleep: async () => {}, gate: null, maxRetries: 1 });
  const buyer = await generateEd25519KeyPair("hotel-key");
  wholesaler = await generateEd25519KeyPair("dock-wholesaler-test");
  ledger = new Ledger(undefined, () => NOW);
  dock = createDock({
    catalog: new MeteredCatalog(new ValioCatalog(index, live, { now: () => NOW })),
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
    wholesalerKey: wholesaler,
    notifier: new InMemoryOutbox(),
    now: () => NOW,
    kitchens: new InMemoryKitchenRepository(),
    liveAllowance: opts.allowance,
  });
  const m = sampleMandate(NOW, { perOrderLimitCents: 50_000 });
  session = await dock.authenticate(await signMandate(m, buyer), m.agentId);
}

const milk = (over: Record<string, unknown> = {}) => ({
  need: {
    text: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.",
    item: { text: "lactose-free milk", category: "milk", attributes: ["semi-skimmed"] },
    quantity: { amount: 1000, unit: "L" },
    deliverBy: MONDAY,
    requiredClaims: ["Lactose-free"],
    optimise: "price",
    ...over,
  },
  by: "Purchasing manager",
});

beforeEach(() => setup());

describe("1,000 litres of lactose-free milk by Monday, on the real catalogue's shape", () => {
  it("reaches a signed quote with no question, on the product that can still make Monday", async () => {
    const step = await dock.intake.open(session, milk());
    expect(step.state).toBe("quoted"); // the request says product, amount, date and "price": nothing to ask
    expect(step.concerns).toEqual([]);
    expect(step.need.requiredClaims).toEqual(["lactose_free"]); // "Lactose-free" in the catalogue's words
    expect(step.need.item.attributes).toEqual(["fat_1_5"]); // "semi-skimmed" too
    expect(step.quote!.quote.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents, l.deliveryDate])).toEqual([["900002", 1000, 140, MONDAY]]);

    // The box's passed cut-off is the named reason it is not on offer.
    expect(step.excluded).toContainEqual(expect.objectContaining({ productId: "900001", code: "cutoff_passed", reason: expect.stringMatching(/^order cut-off Thu 12 Nov 15:00 has passed, so it cannot arrive Mon 16 Nov/) }));

    // The live API was asked for Monday: two lookups by Dock (shortlist, quote), the second served from the cache.
    expect(api.calls.map((c) => [c.path, c.body?.requestedDate])).toEqual([
      ["/api/price", MONDAY],
      ["/api/availability", MONDAY],
    ]);
    expect(dock.stats()).toMatchObject({ liveCalls: 2, upstream: { httpRequests: 2, cacheHits: 2 } });

    // The placeholder amount is never printed as stock.
    const lookups = ledger.entries({ requestId: step.requestId }).filter((e) => e.type === "lookup");
    expect(lookups.map((e) => e.summary).join(" ")).not.toMatch(/9999999999/);
    expect(lookups[0].summary).toMatch(/900002 stock not reported at €1.40\/ST, delivery 2026-11-16 if ordered by 2026-11-15 17:00/);

    // Over the €500 the agent may spend alone: a person signs it off.
    const order = await dock.placeOrder(session, step.next.example as never);
    expect(order.status).toBe("pending_approval");
  });

  it("hands out signed claims an outside agent can verify offline, and the quote binds them by hash", async () => {
    const step = await dock.intake.open(session, milk());
    const result = await dock.requestQuote(session, { requestId: step.requestId, lines: [{ productId: "900002", quantity: 1000 }] });
    expect(result.quote.evidence!.map((e) => e.type).sort()).toEqual(["availability", "origin", "price"]);
    for (const ref of result.quote.evidence!) {
      const token = result.claims.find((c) => c.claimId === ref.claimId)!.token;
      expect(sha256Hex(token)).toBe(ref.sha256);
      const claim = await verifyClaim(token, [wholesaler], NOW);
      expect(claim).toMatchObject({ productId: "900002", type: ref.type });
      if (claim.type === "availability") expect(claim.statement).toMatchObject({ deliveryDate: MONDAY, orderBy: "2026-11-15T17:00:00+0200", stock: { known: false, packs: null } });
      if (claim.type === "price") expect(claim).toMatchObject({ audience: "org_laakso", source: "partner-live-api:price", statement: { unitPriceCents: 140, per: "ST" } });
      if (claim.type === "origin") expect(claim.statement).toMatchObject({ countryOfOrigin: "fi", vendor: "KUUSI OY" });
    }
    const price = result.claims.find((c) => c.type === "price")!;
    const [h, p, s] = price.token.split(".");
    const body = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    body.credentialSubject.price.unitPriceCents = 1;
    await expect(verifyClaim([h, base64url.encode(JSON.stringify(body)), s].join("."), [wholesaler], NOW)).rejects.toMatchObject({ code: "claim_signature_invalid" });
    await expect(verifyClaim(price.token, [wholesaler], new Date(NOW.getTime() + 25 * 3600_000))).rejects.toMatchObject({ code: "claim_expired" });
    // The availability claim never outlives the cut-off it names.
    expect(result.claims.find((c) => c.type === "availability")!.validUntil).toBe("2026-11-13T20:30:00.000Z");
    expect((await dock.getClaims(session, [price.claimId])).map((c) => c.claimId)).toEqual([price.claimId]);
  });

  it("without a fat content in the request, the cards span it and nobody is asked first", async () => {
    const step = await dock.intake.open(session, milk({ item: { text: "lactose-free milk", category: "milk" } }));
    expect(step.state).toBe("options_ready");
    expect(step.questions).toEqual([]);
    expect(step.openChoices.map((q) => q.id)).toEqual(["dim:fat"]);
    expect(new Set(step.options.map((o) => o.title.includes("whole") ? "whole" : "semi")).size).toBe(2);
    expect(step.options.every((o) => o.match === "full")).toBe(true);
    // Coffee milk shares the word and the category, but is another kind of product.
    expect(step.excluded).toContainEqual(expect.objectContaining({ productId: "900007", reason: expect.stringMatching(/different kind of product \(coffee\)/) }));
  });

  it("a cut-off passed everywhere is the plain answer", async () => {
    const step = await dock.intake.open(session, milk({ item: { text: "lactose-free milk", category: "milk", productId: "900001" } }));
    expect(step.state).toBe("options_ready"); // the box cannot come: the cartons are offered as a compromise
    expect(step.options.every((o) => o.match === "compromise" && o.givesUp.some((g) => g.part === "product"))).toBe(true);
    expect(step.notes[0]).toMatch(/^The product you named .* cannot do it: order cut-off Thu 12 Nov 15:00 has passed/);
  });

  it("gives the wholesaler the chain without the buyer's private memory", async () => {
    const step = await dock.intake.open(session, milk());
    const { explanation, entries } = auditFor("wholesaler", ledger.entries({ requestId: step.requestId }));
    expect(explanation.join("\n")).toMatch(/\[asked\] agent:agent_buyer_1 asked: "I need 1,000 litres/);
    expect(explanation.join("\n")).toMatch(/\[claimed\] Live lookup for 2 product\(s\) for delivery by 2026-11-16 .*900001 not quotable: cutoff_passed\./);
    expect(explanation.join("\n")).toMatch(/\[quoted\] Quote qt_\w+ for €1,400.00/);
    expect(entries.every((e) => "hash" in e && typeof e.seq === "number")).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/fromMemory|usually|Pre-selected from history/);
  });
});

describe("live service guards", () => {
  it("reports a failed partner service as an outage to retry, not a rule refusal", async () => {
    await setup({ status: 503 });
    const req = await dock.openRequest(session, { text: "milk", neededBy: MONDAY });
    await expect(dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900002"] })).rejects.toMatchObject({ status: 503, code: "live_unavailable", rule: undefined });
    expect(ledger.entries({ requestId: req.requestId }).some((e) => e.type === "refusal")).toBe(false);
  });

  it("applies the per-agent hourly allowance to REST callers too", async () => {
    await setup({ allowance: new LiveLookupAllowance({ windowMinutes: 60, maxCalls: 2, maxDistinctProducts: 30 }, () => NOW) });
    const req = await dock.openRequest(session, { text: "milk", neededBy: MONDAY });
    await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900002"] });
    await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900003"] });
    // An answer the partner gave a moment ago is reused and not counted (F-SHARED-LIVE-ALLOWANCE)...
    await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900002"] });
    // ...but a call that has to reach the partner is refused, with when to retry.
    await expect(dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900004"] })).rejects.toMatchObject({ status: 429, code: "live_lookup_budget_exceeded", rule: "live_lookup_limit", message: expect.stringMatching(/Try again in about \d+ min/) });
    expect(dock.liveAllowance.remaining("org_laakso:agent_buyer_1").callsLeft).toBe(0);
  });

  it("names why products cannot be quoted, with claims on request", async () => {
    const req = await dock.openRequest(session, { text: "milk", neededBy: MONDAY });
    const r = await dock.lookupAvailability(session, { requestId: req.requestId, productIds: ["900001", "900002"], includeClaims: true });
    expect(r.offers.map((o) => o.productId)).toEqual(["900002"]);
    expect(r.unavailable).toEqual([expect.objectContaining({ productId: "900001", problems: expect.arrayContaining(["cutoff_passed", "stock_unknown"]) })]);
    expect(r.offers[0].claims).toEqual({ price: expect.any(String), availability: expect.any(String), origin: expect.any(String) });
    expect(r.claims!.length).toBe(6); // price, availability and origin for both: the box's say why it cannot be had
  });
});
