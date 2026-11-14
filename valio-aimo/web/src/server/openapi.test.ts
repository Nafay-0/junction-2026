import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as openapiRoute } from "@/app/api/v1/openapi.json/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { localFetch } from "./local-transport";
import { API, UNDOCUMENTED_ROUTES, buildOpenApi } from "./openapi";
import { resetRuntime } from "./runtime";
import { setInterpretModelForTests } from "./agent/interpret";
import { scriptedModel } from "./agent/testing";

const BASE = "https://dock.test";
const V1 = join(__dirname, "..", "app", "api", "v1");

/** Every exported GET/POST of every route file under src/app/api/v1, as "get /api/v1/orders/{orderId}". */
async function routesOnDisk(): Promise<string[]> {
  const files = readdirSync(V1, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("route.ts"));
  const found: string[] = [];
  for (const f of files) {
    const dir = relative(V1, join(V1, f, "..")).split("\\").join("/");
    const path = ("/api/v1/" + dir).replace(/\/$/, "").replace(/\[(\w+)\]/g, "{$1}");
    const mod = (await import(/* @vite-ignore */ join(V1, f))) as Record<string, unknown>;
    for (const m of ["GET", "POST"]) if (typeof mod[m] === "function") found.push(`${m.toLowerCase()} ${path}`);
  }
  return found.sort();
}

describe("OpenAPI document", () => {
  it("is a valid OpenAPI 3.1 document", async () => {
    const res = await new Validator().validate(buildOpenApi(BASE));
    expect(res.errors ?? []).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("documents exactly the routes that exist", async () => {
    const onDisk = (await routesOnDisk()).filter((r) => !UNDOCUMENTED_ROUTES.some((u) => r.endsWith(" " + u)));
    const documented = API.map((op) => `${op.method} ${op.path}`).sort();
    expect(documented).toEqual(onDisk);
  });

  it("marks the buyer's own answers and tags approver operations, which the agent view leaves out", async () => {
    type Doc = { paths: Record<string, Record<string, { operationId: string; tags: string[]; "x-dock-audience": string; "x-dock-human-input"?: { required: boolean; from: string } }>> };
    const ops = (d: Doc) => Object.values(d.paths).flatMap((p) => Object.values(p));
    const all = ops(buildOpenApi(BASE) as unknown as Doc);
    expect(all.filter((o) => o["x-dock-human-input"]).map((o) => o.operationId).sort()).toEqual(["answerQuestions", "respondToConcerns"]);
    expect(all.find((o) => o.operationId === "respondToConcerns")!["x-dock-human-input"]).toMatchObject({ required: true, from: "buyer" });
    const approver = all.filter((o) => o["x-dock-audience"] === "approver").map((o) => o.operationId);
    expect(approver).toEqual(expect.arrayContaining(["decideApproval", "approvalChallenge", "approvalLink", "beginJoin", "completeJoin", "approverDemoOrder", "sandboxDemoOrder", "listSandboxes"]));
    for (const o of all) expect(o.tags).toEqual([o["x-dock-audience"]]);
    expect(all.find((o) => o.operationId === "placeOrder")!["x-dock-audience"]).toBe("agent");
    const res = await openapiRoute(new Request(`${BASE}/api/v1/openapi.json?audience=agent`));
    const agentOps = ops((await res.json()) as Doc).map((o) => o.operationId);
    expect(agentOps).toContain("openIntake");
    for (const id of approver) expect(agentOps).not.toContain(id);
    expect((await new Validator().validate(buildOpenApi(BASE, { audience: "agent" }))).valid).toBe(true);
  });

  it("is what /api/v1/openapi.json serves", async () => {
    const res = await openapiRoute(new Request(`${BASE}/api/v1/openapi.json`));
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApi(BASE))));
  });
});

describe("real responses match the documented status codes and schemas", () => {
  let mandate: string;
  beforeEach(async () => {
    resetRuntime();
    mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  });

  const seen = new Set<string>();
  /** The first `data:` of a server-sent event stream (or null if the stream opened without one), then hang up. */
  async function firstEvent(res: Response): Promise<unknown> {
    const reader = res.body!.getReader();
    const idle = () => new Promise<ReadableStreamReadDoneResult<Uint8Array>>((r) => setTimeout(() => r({ done: true, value: undefined }), 50));
    let text = "";
    for (let chunk: ReadableStreamReadResult<Uint8Array> = await reader.read(); chunk.value; chunk = await Promise.race([reader.read(), idle()])) {
      text += new TextDecoder().decode(chunk.value);
      if (text.includes("\ndata: ")) break;
    }
    await reader.cancel();
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return data ? JSON.parse(data.slice(6)) : null;
  }
  async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await localFetch(new Request(BASE + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const sse = res.headers.get("content-type")?.startsWith("text/event-stream");
    const json = sse ? await firstEvent(res) : await res.json();
    const pathname = new URL(BASE + path).pathname;
    const op = API.find((o) => o.method === method.toLowerCase() && new RegExp(`^${o.path.replace(/\{\w+\}/g, "[^/]+")}$`).test(pathname));
    expect(op, `${method} ${pathname} is documented`).toBeDefined();
    const documented = op!.responses[res.status];
    expect(documented, `${method} ${op!.path} documents status ${res.status}`).toBeDefined();
    expect(res.headers.get("content-type")?.split(";")[0], `${method} ${op!.path} ${res.status} content type`).toBe(documented.contentType ?? "application/json");
    const parsed = sse && json === null ? { success: true as const } : documented.schema.safeParse(json);
    expect(parsed.success ? null : parsed.error.issues, `${method} ${op!.path} ${res.status} matches its schema`).toBeNull();
    seen.add(`${op!.method} ${op!.path} ${res.status}`);
    return { status: res.status, body: json, headers: res.headers };
  }
  const agent = (method: "GET" | "POST", path: string, body?: unknown) => call(method, path, body, { authorization: `Bearer ${mandate}`, "dock-agent-id": DEMO_ORG.agentId });

  it("over the full flow and its refusals", async () => {
    await call("GET", "/api/v1");
    expect((await call("POST", "/api/v1/requests", { text: "milk" })).status).toBe(401);
    expect((await call("POST", "/api/v1/requests", { text: "milk" }, { authorization: `Bearer ${mandate}`, "dock-agent-id": "someone" })).status).toBe(403);
    expect((await agent("POST", "/api/v1/requests", { text: "" })).status).toBe(400);
    const requestId = (await agent("POST", "/api/v1/requests", { text: "1,000 L lactose-free milk", neededBy: "2099-01-01" })).body.request.requestId;

    await agent("GET", `/api/v1/products?requestId=${requestId}&q=milk&attribute=lactose_free&attribute=fat_1_5`);
    expect((await agent("GET", `/api/v1/products?requestId=req_nope`)).status).toBe(404);
    await agent("POST", "/api/v1/availability", { requestId, productIds: ["VA-1010", "AR-2010"] });
    expect((await agent("POST", "/api/v1/availability", { requestId, productIds: Array.from({ length: 11 }, (_, i) => `X-${i}`) })).status).toBe(400);
    expect((await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 100 }] })).status).toBe(409);

    const sub = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] });
    const pick = (q: { quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] } }) => q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));
    const pending = await agent("POST", "/api/v1/orders", { requestId, quoteToken: sub.body.quoteToken, lines: pick(sub.body) });
    expect((await agent("POST", "/api/v1/watch/backup", { orderId: pending.body.order.orderId })).status).toBe(200); // no poor-record product: no backups
    expect(pending.status).toBe(202);
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: "a.b.c", lines: [] })).status).toBe(422);

    const small = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1001", quantity: 10 }] });
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: small.body.quoteToken, lines: pick(small.body) })).status).toBe(201);
    const oat = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "PK-4001", quantity: 10 }] });
    expect((await agent("POST", "/api/v1/orders", { requestId, quoteToken: oat.body.quoteToken, lines: pick(oat.body) })).status).toBe(422);

    const again = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity: 60 }, { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] });
    const second = await agent("POST", "/api/v1/orders", { requestId, quoteToken: again.body.quoteToken, lines: pick(again.body) });
    expect(second.status).toBe(202);
    const withdrawn = await agent("POST", `/api/v1/orders/${second.body.order.orderId}/withdraw`, { reason: "ordered by phone" });
    expect(withdrawn.body.order.status).toBe("withdrawn");
    expect((await agent("POST", `/api/v1/orders/${second.body.order.orderId}/withdraw`, {})).status).toBe(409);

    expect((await call("GET", "/api/v1/approvals")).status).toBe(401);
    await agent("GET", "/api/v1/approvals");
    const msg = (await localFetch(new Request(`${BASE}/api/v1/dev/outbox`)).then((r) => r.json())).messages[0];
    expect((await call("POST", `/api/v1/approvals/${msg.approvalId}`, { decision: "approve", token: "wrong" })).status).toBe(403);
    expect((await call("POST", `/api/v1/approvals/${msg.approvalId}`, { decision: "approve", token: new URL(msg.link, BASE).searchParams.get("token") })).status).toBe(200);
    expect((await agent("GET", `/api/v1/orders/${pending.body.order.orderId}`)).body.order.status).toBe("committed");
    expect((await agent("GET", "/api/v1/orders/ord_nope")).status).toBe(404);
    expect((await agent("GET", `/api/v1/orders/${pending.body.order.orderId}?wait=1`)).body).toMatchObject({ decided: true });
    const tres = await agent("GET", `/api/v1/orders/${pending.body.order.orderId}/timeline`);
    const timeline = tres.body.timeline;
    expect(timeline).toMatchObject({ status: "committed", complete: { ok: true } });
    expect(timeline.steps.map((s: { ledger: { type: string } }) => s.ledger.type)).toEqual(expect.arrayContaining(["request", "quote", "decision", "approval_requested", "approval", "order"]));
    expect((await agent("GET", "/api/v1/orders?status=committed")).body.orders.length).toBeGreaterThan(0);
    const looked = await agent("POST", "/api/v1/lookup", { text: "milk", requiredClaims: ["lactose_free"], quantity: { amount: 100, unit: "L" }, limit: 3 });
    expect(looked.status, JSON.stringify(looked.body).slice(0, 400)).toBe(200);
    expect(looked.body.products[0].live).toMatchObject({ unitPriceCents: expect.any(Number) });
    expect((await agent("POST", "/api/v1/lookup", {})).status).toBe(400);
    expect((await agent("POST", "/api/v1/alternatives", { requestId: looked.body.requestId, productId: "VA-1010", quantity: { amount: 1000, unit: "L" } })).body.alternatives.length).toBeGreaterThan(0);
    await call("GET", `/api/v1/ledger?requestId=${requestId}`);
    await call("GET", "/api/v1/keys");

    // The intake, as the returning demo kitchen: mistake check, options (memory answers the rest), an answer, choice, quote.
    const kitchenMandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
    const kitchen = (m: "GET" | "POST", path: string, body?: unknown) => call(m, path, body, { authorization: `Bearer ${kitchenMandate}`, "dock-agent-id": KITCHEN_ORG.agentId });
    const day = nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
    expect((await kitchen("POST", "/api/v1/intake", { need: { item: { text: "milk" } } })).status).toBe(400);
    let step = (await kitchen("POST", "/api/v1/intake", { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: day }, by: "Sanna" })).body.step;
    expect(step.state).toBe("needs_confirmation");
    expect((await kitchen("POST", `/api/v1/intake/${step.requestId}/choice`, { by: "Sanna", optionId: "opt_1" })).status).toBe(409);
    step = (await kitchen("POST", step.next.path, { by: "Sanna", responses: step.concerns.map((c: { key: string; corrections: { id: string }[] }) => ({ key: c.key, choice: c.corrections[0].id })) })).body.step;
    expect(step.state).toBe("options_ready");
    step = (await kitchen("POST", `/api/v1/intake/${step.requestId}/answers`, { by: "Sanna", answers: [{ questionId: "optimise", optionId: "no_preference" }] })).body.step;
    expect(step.state).toBe("options_ready");
    step = (await kitchen("POST", step.next.path, { by: "Sanna", optionId: step.options[0].optionId })).body.step;
    expect(step.state).toBe("quoted");
    await kitchen("GET", `/api/v1/intake/${step.requestId}`);
    expect((await kitchen("GET", "/api/v1/intake/req_nope")).status).toBe(404);
    await kitchen("GET", "/api/v1/kitchen");

    // The wholesaler's offers: a campaign the selling agent makes for Kaari, then the buyer's answers over REST.
    const { startCampaign } = await import("./offers/service");
    const { getRuntime } = await import("./runtime");
    await startCampaign(await getRuntime(), { productId: "VA-1201", by: "Staff", listAsNew: true });
    await startCampaign(await getRuntime(), { productId: "VA-1002", by: "Staff", listAsNew: true });
    const listed = (await kitchen("GET", "/api/v1/offers")).body.offers as { offerId: string }[];
    expect(listed.length).toBe(2);
    await kitchen("GET", "/api/v1/offers?all=true");
    expect((await kitchen("POST", "/api/v1/offers/ofr_nope/decline", {})).status).toBe(404);
    expect((await kitchen("POST", `/api/v1/offers/${listed[0].offerId}/accept`, { packs: 2, by: "Sanna" })).status).toBe(201);
    expect((await kitchen("POST", `/api/v1/offers/${listed[0].offerId}/accept`, {})).status).toBe(409);
    await kitchen("POST", `/api/v1/offers/${listed[1].offerId}/decline`, { by: "Sanna" });
    expect((await kitchen("POST", "/api/v1/offers/mute", { scope: "sideways" })).status).toBe(400);
    await kitchen("POST", "/api/v1/offers/mute", { scope: "all", by: "Sanna" });

    // The kitchen agent's watch: a stock-out staged for Kaari, the finding and an answer, auto-renew.
    const { stageStockOut } = await import("./watch/service");
    await stageStockOut(await getRuntime(), { kitchen: "kaari", productId: "VA-1010", by: "Staff" });
    const watched = (await kitchen("GET", "/api/v1/watch?fresh=true")).body as { findings: { findingId: string }[] };
    expect(watched.findings.length).toBeGreaterThan(0);
    expect((await kitchen("POST", "/api/v1/watch/answer", { choice: "switch", by: "Sanna" })).status).toBe(400);
    expect((await kitchen("POST", "/api/v1/watch/answer", { findingId: "wf_nope", choice: "keep", by: "Sanna" })).status).toBe(404);
    await kitchen("POST", "/api/v1/watch/answer", { findingId: watched.findings[0].findingId, choice: "keep", by: "Sanna" });
    expect((await kitchen("POST", "/api/v1/watch/auto-renew", { family: "nothing", on: true, by: "Sanna" })).status).toBe(404);
    await kitchen("POST", "/api/v1/watch/auto-renew", { family: "milk", on: false, by: "Sanna" });
    expect((await kitchen("POST", "/api/v1/watch/backup", { orderId: "ord_nope" })).status).toBe(404);


    // The menu scenarios, with a scripted planner (no provider is called).
    const { setMenuModelForTests } = await import("./agent/menu/runtime");
    const { scriptedPlanner, MILK_DRAFT } = await import("./agent/menu/testing");
    setMenuModelForTests(scriptedPlanner(MILK_DRAFT));
    try {
      expect((await agent("POST", "/api/v1/menus/seasonal", {})).status).toBe(400);
      const seasonal = (await agent("POST", "/api/v1/menus/seasonal", { text: "Lunch for 40, something in season", have: ["butter"] })).body.result;
      await agent("POST", "/api/v1/menus/event", { text: "Unexpected booking for 40, milk with lunch" });
      const ideas = (await agent("POST", "/api/v1/menus/ideas", { text: "Something for lunch for 40" })).body.result;
      await agent("POST", "/api/v1/menus/dish", { ideasId: ideas.ideasId, dishId: ideas.ideas[0].dishId, covers: 40 });
      expect((await agent("POST", "/api/v1/menus/plan_nope/order", {})).status).toBe(404);
      expect((await agent("POST", `/api/v1/menus/${seasonal.planId}/order`, { by: "Aino" })).status).toBe(201);
    } finally {
      setMenuModelForTests(undefined);
    }

    // Free text to a structured need, with a scripted model (no provider is called).
    const scripted = { item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null }, quantity: { amount: 1000, unit: "L" }, deliverBy: null, requiredClaims: [], forbiddenAllergens: [], optimise: "price", sameAsLastTime: false, isPurchaseRequest: true, notPurchaseReason: null };
    setInterpretModelForTests({ ...scriptedModel([{ text: JSON.stringify(scripted) }]), id: "scripted:interpret" });
    try {
      const read = await kitchen("POST", "/api/v1/agent/interpret", { text: "1000 l laktoositonta maitoa, halvin" });
      expect(read.body).toMatchObject({ need: { quantity: { amount: 1000, unit: "L" }, item: { category: "milk" } }, model: "scripted:interpret" });
      expect((await kitchen("POST", "/api/v1/agent/interpret", { text: "" })).status).toBe(400);
      setInterpretModelForTests({ ...scriptedModel([{ text: JSON.stringify({ ...scripted, isPurchaseRequest: false, notPurchaseReason: "A question about opening hours." }) }]), id: "scripted:interpret" });
      expect((await kitchen("POST", "/api/v1/agent/interpret", { text: "When do you open on Saturdays?" })).status).toBe(422);
    } finally {
      setInterpretModelForTests(undefined);
    }

    // The approver's phone: join with a passkey, the kitchen's agent orders, sign off with the passkey.
    const phone = new SoftwareAuthenticator(BASE);
    const start = await call("POST", "/api/v1/join");
    const joined = await call("POST", "/api/v1/join/verify", { response: phone.register(start.body.options) });
    expect(joined.status).toBe(201);
    const cookie = { cookie: joined.headers.get("set-cookie")!.split(";")[0] };
    expect((await call("POST", "/api/v1/join/verify", {})).status).toBe(400);
    expect((await call("GET", "/api/v1/approver")).status).toBe(401);
    await call("GET", "/api/v1/approver", undefined, cookie);
    const sandboxes = (await call("GET", "/api/v1/sandboxes")).body.sandboxes;
    const placed = (await call("POST", "/api/v1/approver/demo-order", undefined, cookie)).body.order;
    expect(placed.status).toBe("pending_approval");
    const mySandbox = joined.body.sandbox.sandboxId;
    expect(sandboxes[0].sandboxId).toBeUndefined(); // strangers get names, not ids
    expect((await call("POST", `/api/v1/sandboxes/${mySandbox}/demo-order`)).status).toBe(401);
    expect((await call("POST", `/api/v1/sandboxes/${mySandbox}/demo-order`, undefined, cookie)).status).toBe(201);
    expect((await call("GET", `/api/v1/approvals/${placed.approvalId}`)).status).toBe(404);
    await call("GET", `/api/v1/approvals/${placed.approvalId}`, undefined, cookie);
    await call("GET", `/api/v1/approvals/${placed.approvalId}/link`, undefined, cookie);
    expect((await call("POST", `/api/v1/approvals/${placed.approvalId}/challenge`, { decision: "maybe" })).status).toBe(400);
    const challenge = (await call("POST", `/api/v1/approvals/${placed.approvalId}/challenge`, { decision: "approve" })).body.options;
    const signed = await call("POST", `/api/v1/approvals/${placed.approvalId}`, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(challenge) } });
    expect(signed.body.view.state).toBe("committed");
    expect((await call("POST", `/api/v1/approvals/${placed.approvalId}/challenge`, { decision: "approve" })).status).toBe(409);
    expect((await call("GET", "/api/v1/events?scope=mine")).status).toBe(401);
    expect((await call("GET", `/api/v1/events?since=0&approvalId=${placed.approvalId}`, undefined, cookie)).body).toMatchObject({ type: "approval_requested" });
    expect((await call("GET", `/api/v1/events?since=0&approvalId=${placed.approvalId}`)).status).toBe(404);
    const pub = (await call("GET", "/api/v1/events?since=0")).body;
    expect(pub).toMatchObject({ type: expect.any(String) });
    expect(pub.orgId).toBeUndefined(); // the public stream says what happened, never whose

    // Every documented operation was exercised at least once with a success status.
    const ok = new Set([...seen].filter((k) => /\s2\d\d$/.test(k)).map((k) => k.replace(/\s\d+$/, "")));
    const untested = API.map((o) => `${o.method} ${o.path}`).filter((k) => !ok.has(k) && k !== "get /api/v1/openapi.json");
    expect(untested).toEqual([]);
  });
});
