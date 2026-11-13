import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as drillListing } from "@/app/ui-api/radar/drill/route";
import { GET as drillNotice } from "@/app/ui-api/radar/drill/[slug]/route";
import { signMandate } from "@/core/mandate";
import type { AgentSession, Dock } from "@/core/orders";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { approvalViewFor } from "../approval-api";
import { getRuntime, resetRuntime, type Runtime } from "../runtime";
import { buildFacts } from "./facts";
import { InMemoryCatalog, type CatalogPort } from "@/core/catalog";
import { recallAwareCatalog } from "./gate";
import { ContextDev, Exa, type FetchFn, type ScrapeResponse } from "./partners";
import { readListing, readPage, type ReaderDeps } from "./readers";
import { RadarRegistry, radar } from "./registry";
import { sourceOf } from "./sources";
import { kitchenNotices } from "./views";

/**
 * The radar end to end without the network: recorded Context.dev responses for the readers, and the drill page
 * served by its own route handlers for the drill. Live checks are opt-in: RADAR_LIVE=1 pnpm test radar.live.
 */

const FIX = path.join(__dirname, "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIX, name), "utf8")) as ScrapeResponse;

/** A Context.dev client that answers from recorded responses and fails the test if anything else is asked. */
function recordedContextDev(byUrl: Record<string, ScrapeResponse>): ContextDev {
  const cd = new ContextDev({ contextDevCredits: 0, contextDevCalls: 0, exaDollars: 0, exaCalls: 0, cacheHits: 0, since: "" }, {
    apiKey: "test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { url: string };
      const hit = byUrl[body.url];
      if (!hit) throw new Error(`No recording for ${body.url}`);
      return new Response(JSON.stringify(hit), { status: 200, headers: { "x-credits-used": "1" } });
    },
  });
  return cd;
}

const noNetwork: FetchFn = async (url) => {
  throw new Error(`unexpected network call to ${url}`);
};

/** Serves Dock's own drill page through its route handlers, as a browser or Context.dev would fetch it. */
const drillFetch: FetchFn = async (url) => {
  const u = new URL(url);
  const m = /^\/ui-api\/radar\/drill(?:\/([^/]+))?\/?$/.exec(u.pathname);
  if (!m) throw new Error(`unexpected fetch ${url}`);
  const req = new Request(url);
  return m[1] ? drillNotice(req, { params: Promise.resolve({ slug: m[1] }) }) : drillListing(req);
};

let rt: Runtime;
let r: RadarRegistry;
let session: AgentSession;

beforeAll(() => {
  process.env.RADAR_GTIN_INDEX = path.join(FIX, "no-such-gtin-index.json.gz");
});
afterAll(() => {
  delete process.env.RADAR_GTIN_INDEX;
});

beforeEach(async () => {
  resetRuntime();
  rt = await getRuntime();
  r = radar(rt);
  // No partner is called in these tests: Context.dev and Exa have no key, and the drill page is read directly.
  r.deps.cd = new ContextDev(r.state.spend, { apiKey: "", fetch: noNetwork });
  r.deps.exa = new Exa(r.state.spend, { apiKey: "", fetch: noNetwork });
  r.deps.fetch = drillFetch;
  r.deps.drill = { localOrigin: "http://127.0.0.1:3999" };
  session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
});

async function quote(dock: Dock, productId: string, quantity: number) {
  const req = await dock.openRequest(session, { text: "milk" });
  return { req, ...(await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity }] })) };
}

const linesOf = (q: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }) => q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

async function drillAndPickUp(productId: string) {
  const d = await r.publishDrill({ productId, by: "Riikka (ops)" });
  await r.checkSource("drill", { force: true });
  return d;
}

describe("readers, on recorded Context.dev responses", () => {
  it("reads the authority's listing with the CSS parser", async () => {
    const listing = fixture("ruokavirasto-fi-listing.json");
    const deps = { cd: recordedContextDev({ "https://www.ruokavirasto.fi/takaisinvedot/": listing }), exa: new Exa({} as never, { apiKey: "" }), now: () => new Date("2026-11-14T10:00:00Z"), drill: {} } satisfies ReaderDeps;
    const read = await readListing(sourceOf("ruokavirasto-fi")!, deps);
    expect(read.via).toBe("context.dev");
    expect(read.items.length).toBeGreaterThan(50);
    expect(read.items[0]).toMatchObject({ publishedOn: "2026-11-11" });
    expect(read.items[0].url).toMatch(/^https:\/\/www\.ruokavirasto\.fi\/elintarvikkeet\//);
  });

  it("reads a Finnish notice into facts, keeping the sentences and checking them against the page", async () => {
    const rec = fixture("ruokavirasto-fi-oat-drink.json");
    const deps = { cd: recordedContextDev({ [rec.url]: rec }), exa: new Exa({} as never, { apiKey: "" }), now: () => new Date("2026-11-14T10:00:00Z"), drill: {} } satisfies ReaderDeps;
    const page = await readPage(rec.url, sourceOf("ruokavirasto-fi")!, deps);
    const f = buildFacts({ text: page.text, title: page.title!, publishedOn: page.publishedOn, model: page.model, seenOn: "2026-11-14" });
    expect(page.publishedOn).toBe("2026-04-02");
    expect(f.eans).toEqual(["6411200000082"]);
    expect(f.products[0]).toMatchObject({ eans: ["6411200000082"], lots: { bestBefore: ["2026-10-05"] } });
    expect(f.products[0].name.verified).toBe(true);
    expect(f.hazard.kind).toBe("spoilage");
    expect(f.hazard.text?.verified).toBe(true);
    expect(f.hazard.text?.english).toMatch(/shelf life/);
  });

  it("reads a Swedish notice: four products, stamps, and 'or earlier' dates", async () => {
    const rec = fixture("ruokavirasto-sv-eggs.json");
    const deps = { cd: recordedContextDev({ [rec.url]: rec }), exa: new Exa({} as never, { apiKey: "" }), now: () => new Date("2026-11-14T10:00:00Z"), drill: {} } satisfies ReaderDeps;
    const page = await readPage(rec.url, sourceOf("ruokavirasto-sv")!, deps);
    const f = buildFacts({ text: page.text, title: page.title!, publishedOn: page.publishedOn, model: page.model, seenOn: "2026-11-14" });
    expect(page.model?.language).toBe("sv");
    expect(f.products).toHaveLength(4);
    expect(f.eans).toHaveLength(4);
    expect(f.lots.bestBeforeUpTo).toBe("2026-10-28");
    expect(f.lots.marks).toContain("1FI15493");
    expect(f.hazard.kind).toBe("microbial");
  });
});

describe("a source that is down or changes its layout", () => {
  it("is a status on the screen, not an alarm and not 'no recalls'", async () => {
    r.deps.cd = new ContextDev(r.state.spend, { apiKey: "test", fetch: async () => { throw new TypeError("fetch failed"); } });
    const before = rt.dock.ledger.entries().length;
    const st = await r.checkSource("ruokavirasto-fi");
    expect(st.status).toBe("down");
    expect(st.lastError).toMatch(/could not be reached/);
    expect(rt.dock.ledger.entries().length).toBe(before);
  });

  it("a listing that suddenly parses to nothing is a layout change, read by meaning once", async () => {
    r.state.sources["ruokavirasto-fi"].listedLastTime = 102;
    const empty = { url: "https://www.ruokavirasto.fi/takaisinvedot/", parsed: { requested: true, success: true, data: { items: [] } }, json: { requested: true, success: true, data: { items: [] } } } as ScrapeResponse;
    r.deps.cd = recordedContextDev({ "https://www.ruokavirasto.fi/takaisinvedot/": empty });
    const st = await r.checkSource("ruokavirasto-fi");
    expect(st.status).toBe("layout_changed");
    expect(r.state.matches).toHaveLength(0);
  });

  it("stops spending at the budget", async () => {
    r.state.spend.contextDevCredits = 1_000_000;
    r.deps.cd = new ContextDev(r.state.spend, { apiKey: "test", fetch: noNetwork });
    const st = await r.checkSource("ruokavirasto-fi");
    expect(st.status).toBe("paused");
    expect(st.lastError).toMatch(/credits/);
  });
});

describe("the drill", () => {
  it("travels the real path (listing, notice page, reader, matching) and holds the product", async () => {
    const d = await drillAndPickUp("VA-1001");
    const n = r.state.notices.find((x) => x.sourceId === "drill")!;
    expect(n.readBy).toBe("direct");
    expect(n.url).toBe(`http://127.0.0.1:3999/ui-api/radar/drill/${d.slug}`);
    expect(n.facts?.products[0].name.value).toBe(d.names.fi ?? d.productName);
    const m = r.state.matches.find((x) => x.noticeId === n.noticeId)!;
    expect(m).toMatchObject({ productId: "VA-1001", strength: "confirmed", basis: "producer_name_pack", status: "confirmed" });
    expect(r.store.activeHolds(["VA-1001"])).toHaveLength(1);
    const drill = r.state.drills[0];
    expect(drill.pickedUpAt).toBeTruthy();
    expect(drill.heldAt).toBeTruthy();
  });

  it("is never recorded as a real recall: marked DRILL in the notice, the hold, the refusal and every ledger entry", async () => {
    await drillAndPickUp("VA-1001");
    const q = await quote(rt.dock, "VA-1001", 10).catch((e: unknown) => e);
    expect(q).toMatchObject({ rule: "recall_hold", status: 409 });
    expect((q as Error).message).toMatch(/^DRILL, not a real recall/);
    expect(r.state.notices.every((n) => n.sourceId !== "drill" || n.drill)).toBe(true);
    expect(r.state.holds.every((h) => h.drill)).toBe(true);
    const radarEntries = rt.dock.ledger.entries().filter((e) => String(e.data.action ?? "").startsWith("recall_") || e.data.rule === "recall_hold");
    expect(radarEntries.length).toBeGreaterThanOrEqual(3); // published, hold, refusal
    for (const e of radarEntries) {
      expect(e.data.drill, e.summary).toBe(true);
      expect(e.summary, e.summary).toMatch(/DRILL/);
    }
    const page = await (await drillListing(new Request("http://x/ui-api/radar/drill"))).text();
    expect(page).toMatch(/HARJOITUS \/ DRILL/);
  });
});

describe("the hold at the gate", () => {
  it("refuses an autonomous quote and an order quoted before the hold, naming the notice, and the agent hears of alternatives", async () => {
    const before = await quote(rt.dock, "VA-1001", 10); // quoted while there was no hold
    await drillAndPickUp("VA-1001");
    const refusedQuote = await quote(rt.dock, "VA-1001", 10).catch((e: unknown) => e);
    expect(refusedQuote).toMatchObject({ rule: "recall_hold", code: "product_on_recall_hold" });
    const refusedOrder = await rt.dock.placeOrder(session, { requestId: before.req.requestId, quoteToken: before.quoteToken, lines: linesOf(before.quote) }).catch((e: unknown) => e);
    expect(refusedOrder).toMatchObject({ rule: "recall_hold", status: 409 });
    const details = (refusedOrder as { details: { noticeUrl: string; alternatives: { productId: string }[] } }).details;
    expect(details.noticeUrl).toMatch(/\/ui-api\/radar\/drill\//);
    expect(details.alternatives.map((a) => a.productId)).not.toContain("VA-1001");
    expect(details.alternatives.length).toBeGreaterThan(0);
    // The live status the intake's options logic reads says why, so it leaves the product out and ranks the rest.
    const [status] = await (recallAwareCatalog(rt.catalog, (ids) => r.store.activeHolds(ids)) as CatalogPort).getLiveStatus!(["VA-1001"]);
    expect(status).toMatchObject({ orderable: false, problems: expect.arrayContaining(["sales_block"]) });
    expect(status.message).toMatch(/Held by the wholesaler: DRILL/);
    const refusals = rt.dock.ledger.entries().filter((e) => e.type === "refusal" && e.data.rule === "recall_hold");
    expect(refusals).toHaveLength(2);
  });

  it("flags a waiting order to its approver, refuses its approval, still lets them decline", async () => {
    const big = await quote(rt.dock, "VA-1001", 1000); // €1,490: over the €1,000 the agent may spend alone
    const order = await rt.dock.placeOrder(session, { requestId: big.req.requestId, quoteToken: big.quoteToken, lines: linesOf(big.quote) });
    expect(order.status).toBe("pending_approval");
    await drillAndPickUp("VA-1001");
    const [msg] = rt.outbox.messages();
    const view = await approvalViewFor(rt, new Request("http://x/"), msg.approvalId);
    expect(view.recall?.[0]).toMatchObject({ productId: "VA-1001", drill: true });
    const token = new URL(msg.link, "http://x").searchParams.get("token")!;
    const approve = await rt.dock.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token } }).catch((e: unknown) => e);
    expect(approve).toMatchObject({ rule: "recall_hold", status: 409 });
    expect((await rt.dock.getOrder(session, order.orderId)).status).toBe("pending_approval");
    const declined = await rt.dock.decideApproval(msg.approvalId, { decision: "decline", proof: { kind: "link_token", token }, note: "Recall hold" });
    expect(declined.status).toBe("declined");
  });

  it("tells the kitchen, and once staff lift the hold with a reason, the product can be ordered again", async () => {
    const small = await quote(rt.dock, "VA-1001", 10);
    await rt.dock.placeOrder(session, { requestId: small.req.requestId, quoteToken: small.quoteToken, lines: linesOf(small.quote) });
    await drillAndPickUp("VA-1001");
    const told = await kitchenNotices(rt, { orgId: DEMO_ORG.orgId, agentId: DEMO_ORG.agentId });
    expect(told[0]).toMatchObject({ productId: "VA-1001", drill: true, relation: "received" });
    expect(told[0].action?.value).toMatch(/ammattikeittiöitä/);

    const hold = r.store.activeHolds(["VA-1001"])[0];
    expect(() => r.liftHold(hold.holdId, { reason: " ", by: "Riikka (ops)" })).toThrow(/Say why/);
    r.liftHold(hold.holdId, { reason: "Stock checked: other batch", by: "Riikka (ops)" });
    const again = await quote(rt.dock, "VA-1001", 10);
    expect(again.quote.lines[0].productId).toBe("VA-1001");
    const lifted = rt.dock.ledger.entries().find((e) => e.data.action === "recall_hold_lifted")!;
    expect(lifted.summary).toMatch(/Riikka \(ops\).*Stock checked: other batch/);
  });

  it("a possible match is never a hold until a person confirms it, with a reason, in the ledger", async () => {
    // A fictional assortment and a fictional notice: no real brand is named in a made-up recall.
    const catalog = new InMemoryCatalog([{ id: "T-1", name: "Kuvitelma kaurajuoma kahviin 2,5 dl", brand: "Kuvitelma", category: "plant_drink", unit: "L", packSize: 0.25, attributes: [], allergens: [], certificates: [], deliveryReliability: 0.9, carbonKgPerUnit: 0.5 }], {});
    const fr = new RadarRegistry({ dock: rt.dock, catalog });
    fr.deps.exa = new Exa(fr.state.spend, { apiKey: "", fetch: noNetwork });
    const n = { noticeId: "ntc_test", sourceId: "ruokavirasto-fi" as const, drill: false, url: "https://example.test/notice", title: "Testitiedote (fictional)", language: "fi" as const, publishedOn: fr.today(), seenAt: new Date().toISOString(), state: "listed" as const, corroboration: [], sameAs: [] };
    fr.state.notices.push(n);
    await fr.ingest(n, { text: "Tuote: Kuvitelma kaurajuoma luomu\nTuotemerkki: Kuvitelma\nPakkauskoko: 1 l\nTuotteessa on vierasesineriski.", via: "context.dev", cached: false }, sourceOf("ruokavirasto-fi")!);
    const m = fr.state.matches.find((x) => x.noticeId === n.noticeId)!;
    expect(m).toMatchObject({ productId: "T-1", strength: "possible", status: "review" });
    expect(fr.store.activeHolds(["T-1"])).toHaveLength(0);
    expect(() => fr.review(m.matchId, { decision: "confirm", reason: "", by: "Riikka (ops)" })).toThrow(/Say why/);
    fr.review(m.matchId, { decision: "confirm", reason: "Same product line, checked with the producer", by: "Riikka (ops)" });
    expect(fr.store.activeHolds(["T-1"])[0]).toMatchObject({ placedBy: "operator:Riikka (ops)", drill: false });
    const entry = rt.dock.ledger.entries().find((e) => e.data.action === "recall_review_confirmed")!;
    expect(entry.summary).toMatch(/\(Riikka \(ops\)\) confirmed/);
    expect(entry.summary).not.toMatch(/DRILL/);
  });
});
