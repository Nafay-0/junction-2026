import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { createLocalJWKSet, importJWK, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { GET as jwksRoute } from "@/app/.well-known/jwks.json/route";
import { GET as listRoute } from "@/app/api/v1/offers/route";
import { verifyOffer } from "@/core/offers";
import { signMandate } from "@/core/mandate";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { submitTurn, threadStore } from "@/server/thread/engine";
import type { Card, OrderCard, SheetCard } from "@/server/thread/types";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "../demo-kitchen";
import { offersView, runSellingAgent, startCampaign } from "./service";
import { answerOffer, offerAnswerOf, offerForThread, offerOnSheet } from "./thread";

/**
 * The proactive selling agent end to end, in process: the wholesaler's agent offers (a campaign for a product it lists
 * as new), the kitchen's own agent surfaces it as a sentence, the person says yes, the product goes on the order
 * sheet and the sheet goes through the gate. Then the same as an outside buyer's agent over MCP, with the offer
 * verified offline against the published keys, and the guardrails seen from the buyer's side.
 */

const NEW_MILK = "VA-1201"; // the seed's organic lactose-free milk: allowed for Kaari, never bought there

async function kitchen(slug: string, person?: string): Promise<Kitchen> {
  const k = (await resolveKitchen(slug))!;
  return { ...k, console: { kitchen: slug, session: `test-${slug}`, ...(person ? { person: { channel: "portal_session" as const, name: person } } : {}) } } as Kitchen;
}

async function tap(k: Kitchen, action: Record<string, unknown>): Promise<Card[]> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(k.info.slug, (e) => {
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(k, { door: "typed", via: "tap", action, label: "tap" })).agentTurnId;
  await done;
  return store.agentTurn(store.peek(k.info.slug)!, id)!.cards;
}

async function kaariSession() {
  const rt = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  return { rt, k, session: await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never) };
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_LIVE = "off";
});
afterEach(() => {
  delete process.env.DOCK_MEMORY_LLM;
  delete process.env.DOCK_LIVE;
});

describe("the selling agent's campaign", () => {
  it("picks the kitchens a new product is relevant to, offers it signed, and records every decision", async () => {
    const rt = await getRuntime();
    const c = await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester", listAsNew: true });
    const kaari = c.results.find((r) => r.kitchen === "kaari")!;
    const laakso = c.results.find((r) => r.kitchen === "laakso")!;
    expect(kaari).toMatchObject({ outcome: "offered" });
    expect(laakso).toMatchObject({ outcome: "not_relevant" }); // Laakso has bought no milk yet
    const entries = rt.dock.ledger.entries().filter((e) => e.type === "offer");
    expect(entries.map((e) => e.data.step)).toEqual(expect.arrayContaining(["campaign", "offered"]));
    const view = await offersView(rt);
    expect(view.offers.find((o) => o.kitchen === "kaari")?.reasons.map((r) => r.kind)).toEqual(["new_in_assortment", "new_to_kitchen"]);
    // A claim the data does not back is refused for that kitchen, never sent.
    const c2 = await startCampaign(rt, { productId: "VA-3101", by: "Staff Tester", claims: ["in_season"] });
    expect(c2.results.find((r) => r.kitchen === "kaari")!.outcome).not.toBe("offered");
  });
});

describe("the kitchen's own agent: a sentence, answered in words", () => {
  it("says the offer with its reason, a yes puts it on the order sheet, and the sheet goes through the gate", async () => {
    const { rt, k: resolved, session } = await kaariSession();
    await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester", listAsNew: true });
    const t = await offerForThread(rt, session, resolved.info.name, "en");
    expect(t).toBeTruthy();
    expect(t!.say).toMatch(/Your wholesaler's agent suggests .*new in the range since/);
    expect(t!.ask).toMatch(/^Want 1 × 1 l on/);
    expect(t!.steps.join("\n")).toMatch(/signature verified/);
    expect((await offerForThread(rt, session, resolved.info.name, "fi"))!.say).toMatch(/Tukkurinne agentti ehdottaa/);

    expect(offerAnswerOf("yes please")).toBe("yes");
    expect(offerAnswerOf("no thanks")).toBe("no");
    expect(offerAnswerOf("don't suggest this kind of thing again")).toBe("mute");
    expect(offerAnswerOf("älä ehdota tällaista enää")).toBe("mute");
    const yes = await answerOffer(rt, session, t!.offerId, offerAnswerOf("yes")!, { by: "Mira", via: "store", words: "yes", name: resolved.info.name });
    expect(yes.sheet).toMatchObject({ productId: NEW_MILK, packs: 1 });

    // What the thread does with it: its own order sheet (here through the existing tap), then the gate.
    const k = await kitchen("kaari", "Mira");
    const sheet = (await tap(k, { type: "sheet_add", productId: yes.sheet!.productId, packs: 3 })).find((c): c is SheetCard => c.type === "sheet")!;
    expect(await offerOnSheet(rt, session, t!.offerId, { by: "Mira", via: "store", name: resolved.info.name }, sheet.requestId ?? sheet.sheetId)).toMatch(/order sheet/);
    const placed = await tap(k, { type: "sheet_place", sheetId: sheet.sheetId, version: sheet.version });
    const order = placed.find((c): c is OrderCard => c.type === "order");
    const gate = placed.find((c) => c.type === "gate");
    expect(order?.status ?? (gate as { outcome?: string } | undefined)?.outcome).toBeTruthy();
    expect(rt.dock.ledger.entries().some((e) => e.type === "decision")).toBe(true); // the gate decided, as for any order
    expect((await offersView(rt)).offers.find((o) => o.offerId === t!.offerId)?.status).toBe("accepted");
    // Accepted: not shown again.
    expect(await offerForThread(rt, session, resolved.info.name)).toBeUndefined();
  });

  it("no, and 'don't suggest this kind again', are kept: the selling agent respects both", async () => {
    const { rt, k, session } = await kaariSession();
    await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester", listAsNew: true });
    const t = (await offerForThread(rt, session, k.info.name))!;
    const r = await answerOffer(rt, session, t.offerId, "mute", { by: "Mira", via: "store", words: "never suggest that", name: k.info.name, lang: "en" });
    expect(r.reply).toMatch(/no more suggestions for milk/);
    const again = await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester" });
    expect(again.results.find((x) => x.kitchen === "kaari")).toMatchObject({ outcome: "withheld", rule: "muted" });
  });
});

describe("an outside buyer's agent over MCP", () => {
  const BASE = "http://dock.test";
  async function client() {
    const mandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
    const c = new Client({ name: "outside-buyer", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await c.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { fetch: async (u: string | URL, i?: RequestInit) => mcpRoute(new Request(u, i)), requestInit: { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId } } }));
    return { c, mandate };
  }
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as CallToolResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { isError: !!r.isError, s: r.structuredContent as Record<string, any> };
  };

  it("lists the signed offer, verifies it offline, accepts it into an ordinary order through the gate", async () => {
    const rt = await getRuntime();
    await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester", listAsNew: true });
    const { c, mandate } = await client();
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_offers", "accept_offer", "decline_offer", "mute_offers"]));
    expect(names.some((n) => /approv|sign.?off/.test(n))).toBe(false);

    const listed = await call(c, "list_offers");
    expect(listed.isError).toBe(false);
    const o = listed.s.offers[0];
    expect(o).toMatchObject({ status: "offered", verified: true, offer: { isOrder: false, product: { productId: NEW_MILK } } });
    // Offline: only the published JWK Set and jose.
    const jwks = (await (await jwksRoute(new Request(`${BASE}/.well-known/jwks.json`))).json()) as { keys: JWK[] };
    const keys = await Promise.all(jwks.keys.map(async (j) => ({ kid: j.kid!, publicKey: (await importJWK(j, "Ed25519")) as CryptoKey })));
    expect(await verifyOffer(o.token, keys, { orgId: KITCHEN_ORG.orgId })).toMatchObject({ offerId: o.offerId });
    void createLocalJWKSet;

    // REST sees the same offer.
    const rest = await listRoute(new Request(`${BASE}/api/v1/offers`, { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId } }));
    expect(((await rest.json()) as { offers: { offerId: string }[] }).offers.map((x) => x.offerId)).toContain(o.offerId);

    const accepted = await call(c, "accept_offer", { offerId: o.offerId, packs: 3, by: "Mira" });
    expect(accepted.isError).toBe(false);
    let step = accepted.s.step;
    const requestId = step.requestId as string;
    // An ordinary order from here: answer what the intake asks as the buyer would, choose, place.
    for (let i = 0; i < 4 && step.state !== "options_ready" && step.state !== "quoted"; i++) {
      if (step.state === "needs_confirmation") step = (await call(c, "respond_to_concerns", { requestId, by: "Mira", responses: step.concerns.map((x: { key: string }) => ({ key: x.key, choice: "confirm" })) })).s.step;
      else if (step.state === "needs_input") step = (await call(c, "answer_questions", { requestId, by: "Mira", answers: step.questions.map((q: { questionId: string; options: { optionId: string }[] }) => ({ questionId: q.questionId, optionId: q.options[0].optionId })) })).s.step;
      else break;
    }
    expect(step.state).toBe("options_ready");
    const optionId = (step.preselected?.optionId ?? step.options[0].optionId) as string;
    expect(step.options.some((x: { lines?: { productId: string }[] }) => JSON.stringify(x).includes(NEW_MILK))).toBe(true);
    await call(c, "choose_option", { requestId, optionId, by: "Mira" });
    const placed = await call(c, "place_order", { requestId });
    expect(placed.isError).toBe(false);
    expect(["committed", "pending_approval"]).toContain(placed.s.order.status);
    expect(rt.dock.ledger.entries({ requestId }).some((e) => e.type === "decision")).toBe(true);
    expect((await call(c, "list_offers", { all: true })).s.offers[0].status).toBe("accepted");
  });

  it("offers off through MCP: the selling agent sends nothing more, and says why in the ledger", async () => {
    const rt = await getRuntime();
    await startCampaign(rt, { productId: NEW_MILK, by: "Staff Tester", listAsNew: true });
    const { c } = await client();
    const o = (await call(c, "list_offers")).s.offers[0];
    expect((await call(c, "decline_offer", { offerId: o.offerId })).isError).toBe(false);
    expect((await call(c, "mute_offers", { scope: "all" })).s.prefs.off).toBeTruthy();
    const again = await startCampaign(rt, { productId: "VA-1002", by: "Staff Tester", listAsNew: true });
    expect(again.results.find((x) => x.kitchen === "kaari")).toMatchObject({ outcome: "withheld", rule: "offers_off" });
    const run = await runSellingAgent(rt, { kitchens: ["kaari"] });
    expect(run[0].offered).toEqual([]);
    expect((await call(c, "list_offers")).s.offers).toEqual([]);
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });
});
