import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { MockLanguageModelV4 } from "ai/test";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import * as demoOrderRoute from "@/app/api/v1/approver/demo-order/route";
import * as enrolRoute from "@/app/ui-api/presenter/enrol/route";
import * as enrolVerifyRoute from "@/app/ui-api/presenter/enrol/verify/route";
import { addDaysIso, localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { setInterpretModelForTests } from "@/server/agent/interpret";
import { AIVEN_BUYER, mintMandate } from "@/server/aiven/showcase/launcher";
import { resolveKitchen } from "@/server/console-kitchens";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { localFetch } from "@/server/local-transport";
import { resetMemoryService } from "@/server/memory/runtime";
import { startCampaign } from "@/server/offers/service";
import { answerBackup, backupMomentForThread } from "@/server/reliability/thread";
import { getRuntime, resetRuntime, type Runtime } from "@/server/runtime";
import { setAgentModelForTests } from "@/server/thread/agent";
import { submitTurn, threadStore } from "@/server/thread/engine";
import type { Card } from "@/server/thread/types";
import { runWatch, setAutoRenew, stageStockOut, standingFor } from "@/server/watch/service";

/**
 * One order from each source that can place one, on one in-process dock (seed catalogue, no network, no model:
 * the conversation's two models are scripted stand-ins, as in thread.test.ts). Each source goes through the code
 * path the app uses, so the ledger holds exactly what production writes.
 */
export const SOURCES = ["conversation", "voice", "photo", "mcp", "rest", "aiven_agent", "watch_renewal", "watch_substitute", "offer", "backup", "presenter"] as const;
export type SourceName = (typeof SOURCES)[number];
export type Placed = { orderId: string; requestId: string };

const BASE = "http://dock.test";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

// ---------- the kitchen conversation, its models scripted ----------

function scriptModels(words: string) {
  const need = { isPurchaseRequest: true, notPurchaseReason: null, item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null }, quantity: { amount: 20, unit: "L" }, deliverBy: addDaysIso(localNow(new Date()).date, 4), requiredClaims: ["lactose_free"], forbiddenAllergens: [], optimise: "unstated", sameAsLastTime: false, basedOnRequestId: null, takenFromEarlier: [] };
  setInterpretModelForTests({ model: new MockLanguageModelV4({ provider: "scripted", modelId: "reader", doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(need) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) }), id: "scripted:reader" } as never);
  let i = 0;
  const agent = new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "scripted-agent",
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (i++ === 0) parts.push({ type: "tool-call", toolCallId: `c${i}`, toolName: "order", input: JSON.stringify({ words }) });
      else parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Options below." }, { type: "text-end", id: "t" });
      parts.push({ type: "finish", finishReason: { unified: i === 1 ? "tool-calls" : "stop", raw: undefined }, usage });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  });
  setAgentModelForTests({ model: agent, id: "anthropic:scripted-agent" });
}

async function turn(slug: string, body: Json): Promise<Card[]> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(slug, (e) => {
      if (e.type !== "status" || e.turnId !== id || e.status === "working") return;
      off();
      resolve();
    });
  });
  id = (await submitTurn(slug, body)).agentTurnId;
  await done;
  return store.agentTurn(store.peek(slug)!, id)!.cards;
}

/** Words in through a door (typed, voice, photo), then the buyer taps the first option: the order is placed by the thread. */
async function conversation(slug: string, door: "typed" | "voice" | "photo"): Promise<Placed> {
  const words = "20 litres of lactose-free milk for Thursday";
  scriptModels(words);
  const first = await turn(slug, { door, via: door === "voice" ? "speech" : door === "photo" ? "photo" : "typed", text: words });
  // A kitchen whose memory settles the request (its usual product) gets the order at once; otherwise options, then a tap.
  const options = first.find((c) => c.type === "options");
  const second = first.some((c) => c.type === "order") || options?.type !== "options" ? first : await turn(slug, { door, via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.preselected?.optionId ?? options.options[0].optionId }, label: "Order this" });
  const order = second.find((c) => c.type === "order");
  if (order?.type !== "order") throw new Error(`${slug}/${door}: no order card (${[...first, ...second].map((c) => c.type).join(", ")})`);
  setAgentModelForTests(undefined);
  setInterpretModelForTests(undefined);
  return { orderId: order.orderId, requestId: order.requestId! };
}

// ---------- outside agents ----------

async function mcpClient(headers: Record<string, string>, url = "/api/mcp") {
  const c = new Client({ name: "outside-agent", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await c.connect(new StreamableHTTPClientTransport(new URL(url, BASE), { fetch: async (u: string | URL, init?: RequestInit) => mcpRoute(new Request(u, init)), requestInit: { headers } }));
  await c.listTools();
  return async (name: string, args: Json = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as CallToolResult;
    if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.structuredContent)}`);
    return r.structuredContent as Json;
  };
}

/** The intake over MCP, answered as the buyer's standing answers say (what the Aiven buyer and the offer flow do). */
async function intakeOverMcp(call: Awaited<ReturnType<typeof mcpClient>>, first: Json, by: string): Promise<Placed> {
  let step = first.step;
  const requestId = step.requestId as string;
  for (let n = 0; n < 6 && step.state !== "quoted"; n++) {
    if (step.state === "needs_confirmation") step = (await call("respond_to_concerns", { requestId, by, responses: step.concerns.map((x: Json) => ({ key: x.key, choice: "confirm" })) })).step;
    else if (step.state === "needs_input") step = (await call("answer_questions", { requestId, by, answers: step.questions.map((q: Json) => ({ questionId: q.questionId, optionId: q.options[0].optionId })) })).step;
    else if (step.state === "options_ready") step = (await call("choose_option", { requestId, by, optionId: step.preselected?.optionId ?? step.options[0].optionId })).step;
    else throw new Error(`intake ended as ${step.state}`);
  }
  const placed = await call("place_order", { requestId });
  return { orderId: placed.order.orderId, requestId };
}

const deliveryDay = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;

async function rest(): Promise<Placed> {
  const headers = { "content-type": "application/json", authorization: `Mandate ${await signMandate(demoMandate(new Date()), await demoOrgKeyPair())}`, "dock-agent-id": DEMO_ORG.agentId };
  const post = async (path: string, body: Json) => (await (await localFetch(new Request(BASE + path, { method: "POST", headers, body: JSON.stringify(body) }))).json()) as Json;
  const requestId = (await post("/api/v1/requests", { text: "30 packs of 1 l lactose-free milk", neededBy: "2099-01-01" })).request.requestId as string;
  const q = await post("/api/v1/quotes", { requestId, lines: [{ productId: "VA-1001", quantity: 30 }] });
  const o = await post("/api/v1/orders", { requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }: Json) => ({ productId, quantity, unitPriceCents })) });
  return { orderId: o.order.orderId, requestId };
}

async function mcp(): Promise<Placed> {
  const call = await mcpClient({ authorization: `Bearer ${await signMandate(demoMandate(new Date()), await demoOrgKeyPair())}`, "dock-agent-id": DEMO_ORG.agentId });
  const requestId = (await call("open_request", { text: "40 packs of 1 l lactose-free milk", neededBy: "2099-01-01" })).request.requestId as string;
  const q = await call("request_quote", { requestId, lines: [{ productId: "VA-1001", quantity: 40 }] });
  const o = await call("place_order", { requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }: Json) => ({ productId, quantity, unitPriceCents })) });
  return { orderId: o.order.orderId, requestId };
}

/** The Aiven Managed Agent, without Aiven: its own mandate (launcher.mintMandate) and its integration's URL, ?agent_id= and a bearer token only. */
async function aivenAgent(): Promise<Placed> {
  const call = await mcpClient({ authorization: `Bearer ${await mintMandate()}` }, `/api/mcp?agent_id=${AIVEN_BUYER.agentId}`);
  await call("read_mandate");
  const first = await call("submit_need", { need: { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 60, unit: "L" }, deliverBy: deliveryDay(), requiredClaims: ["lactose_free"], optimise: "price" }, by: "Aino Virtanen" });
  return intakeOverMcp(call, first, "Aino Virtanen");
}

/** The selling agent offers Kaari a new product; Kaari's outside agent accepts over MCP and orders it through the intake. */
async function offer(rt: Runtime): Promise<Placed> {
  await startCampaign(rt, { productId: "VA-1201", by: "Staff Tester", listAsNew: true });
  const call = await mcpClient({ authorization: `Bearer ${await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair())}`, "dock-agent-id": KITCHEN_ORG.agentId });
  const o = (await call("list_offers")).offers[0];
  return intakeOverMcp(call, await call("accept_offer", { offerId: o.offerId, packs: 3, by: "Mira" }), "Mira");
}

// ---------- the watch ----------

async function sessionOf(rt: Runtime, slug: string) {
  const k = (await resolveKitchen(slug))!;
  return { k, session: await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never) };
}

/** Auto-renew on for a recurring order that has not drifted; the watch renews it through the gate. */
async function watchRenewal(rt: Runtime, slug: string, stockOut: boolean): Promise<Placed> {
  const { k, session } = await sessionOf(rt, slug);
  const p = (await standingFor(rt, k.info.orgId)).find((x) => !x.drifted && x.next);
  if (!p) throw new Error(`${slug}: no recurring order without drift`);
  if (stockOut) await stageStockOut(rt, { kitchen: slug, productId: p.product.productId, by: "Staff Tester" });
  await setAutoRenew(rt, session, { family: p.family, on: true, by: "Tester", via: "test", renewNow: false });
  const [r] = await runWatch(rt, { kitchens: [slug], fresh: true, renew: "now" });
  const done = r.renewals.find((x) => x.family === p.family);
  if (!done?.outcome?.orderId) throw new Error(`${slug}: renewal ${done?.state ?? "none"}: ${done?.decision.reason ?? r.note ?? ""} ${JSON.stringify(done?.outcome ?? {})}`);
  return { orderId: done.outcome.orderId, requestId: done.outcome.requestId! };
}

/** Kaari orders a product with a poor delivery record, lines up the backup it offers, the product cannot come: the watch orders the backup. */
async function backup(rt: Runtime): Promise<Placed> {
  const { session } = await sessionOf(rt, "kaari");
  const POOR = "JP-3010";
  const req = await rt.dock.openRequest(session, { text: `4 packs of ${POOR}`, neededBy: addDaysIso(localNow(new Date()).date, 3), productIds: [POOR] });
  const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: POOR, quantity: 4 }] });
  const first = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  const m = await backupMomentForThread(rt, session, { orderId: first.orderId }, "en");
  if (!m) throw new Error("backup: no backup offered");
  await answerBackup(rt, session, m.id, "you_choose", { by: "Sanna Koskinen", via: "test conversation", lang: "en" });
  await stageStockOut(rt, { kitchen: "kaari", productId: POOR, by: "Staff Tester" });
  const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true });
  const f = r.findings.find((x) => x.product.productId === POOR && x.decision?.via === "backup");
  if (!f?.decision?.orderId) throw new Error(`backup: not used (${JSON.stringify(r.findings.map((x) => [x.product.productId, x.decision]))})`);
  return { orderId: f.decision.orderId, requestId: f.decision.requestId! };
}

// ---------- the presenter ----------

/** A presenter enrols a passkey for Laakso's approver, then asks the kitchen's agent for the scripted milk order from that phone. */
async function presenter(): Promise<Placed> {
  const req = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request("https://dock.test" + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const begin = (await (await enrolRoute.POST(req("/ui-api/presenter/enrol", { kitchen: "laakso", presenter: "Tester" }))).json()) as Json;
  const done = await enrolVerifyRoute.POST(req("/ui-api/presenter/enrol/verify", { response: new SoftwareAuthenticator("https://dock.test").register(begin.options) }));
  const cookie = done.headers.get("set-cookie")!.split(";")[0];
  const res = (await (await demoOrderRoute.POST(req("/api/v1/approver/demo-order", undefined, { cookie }))).json()) as Json;
  if (!res.order) throw new Error(`presenter: ${JSON.stringify(res)}`);
  const rt = await getRuntime();
  return { orderId: res.order.orderId, requestId: (await rt.dock.listOrders()).find((o) => o.orderId === res.order.orderId)!.requestId };
}

// ---------- all of them ----------

const NOTES: Record<SourceName, string> = {
  conversation: "thread/engine.submitTurn on laakso, door typed (scripted reader + agent models), then a tap on the first option card",
  voice: "thread/engine.submitTurn on kaari, door voice / via speech, then a tap (session.door = voice)",
  photo: "thread/engine.submitTurn on kahvila-sointu, door photo / via photo (the lines a photo reading hands the thread), then a tap",
  mcp: "POST /api/mcp (stock MCP client, demo agent): open_request -> request_quote -> place_order",
  rest: "localFetch POST /api/v1/requests -> /quotes -> /orders (Mandate header, demo agent)",
  aiven_agent: "POST /api/mcp?agent_id=agent_laakso_aiven_01 with launcher.mintMandate() as bearer: submit_need -> intake answers -> choose_option -> place_order",
  watch_renewal: "watch.setAutoRenew on hotel-lumo (an undrifted family) + runWatch(renew: now) -> renew() -> placeThroughGate",
  watch_substitute: "watch on koulu-metsola: stageStockOut of an undrifted recurring product + auto-renew + runWatch(renew: now) -> renew() onlyStock -> placeThroughGate(substituteFor)",
  offer: "offers.startCampaign(VA-1201) for kaari; kaari's agent over MCP: list_offers -> accept_offer -> intake -> place_order",
  backup: "kaari orders JP-3010 (poor record); reliability.answerBackup(you_choose); stageStockOut; runWatch -> reliability.useBackup -> placeThroughGate",
  presenter: "presenter enrol + verify routes (passkey), then POST /api/v1/approver/demo-order -> sandbox-scenario.runKitchenScenario on laakso",
};

export async function placeOneOfEach(): Promise<{ rt: Runtime; orders: Record<SourceName, Placed>; notes: Record<SourceName, string>; errors: Partial<Record<SourceName, string>> }> {
  resetRuntime();
  resetMemoryService();
  Object.assign(process.env, { DOCK_MEMORY_LLM: "off", DOCK_RATE_LIMITS: "off", DOCK_RELIABILITY_WARN: "0.95" });
  const rt = await getRuntime();
  const steps: [SourceName, () => Promise<Placed>][] = [
    ["conversation", () => conversation("laakso", "typed")],
    ["voice", () => conversation("kaari", "voice")],
    ["photo", () => conversation("kahvila-sointu", "photo")],
    ["mcp", mcp],
    ["rest", rest],
    ["aiven_agent", aivenAgent],
    ["watch_renewal", () => watchRenewal(rt, "hotel-lumo", false)],
    ["watch_substitute", () => watchRenewal(rt, "koulu-metsola", true)],
    ["offer", () => offer(rt)],
    ["backup", () => backup(rt)],
    ["presenter", presenter],
  ];
  const orders = {} as Record<SourceName, Placed>;
  const errors: Partial<Record<SourceName, string>> = {};
  for (const [name, run] of steps) {
    try {
      orders[name] = await run();
    } catch (err) {
      errors[name] = (err as Error).message;
    }
  }
  setAgentModelForTests(undefined);
  setInterpretModelForTests(undefined);
  return { rt, orders, notes: NOTES, errors };
}
