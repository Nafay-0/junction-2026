/**
 * The whole story, end to end, against a local server, with no browser: one line per step, PASS / FAIL / SKIP.
 *
 *   pnpm build && pnpm demo:all              starts `next start` on a free port, runs, stops it (default)
 *   pnpm demo:all --url http://localhost:3301  against a server you run (its own model settings apply)
 *   pnpm demo:all --live                       real models instead of the recorded answers (costs a few cents)
 *   pnpm demo:all --seed                       the 12-product seed catalogue (no partner calls; no knowledge map)
 *
 * By default every model answer comes from scripts/demo-all/recordings.json (the scripted provider in
 * server/agent/scripted.ts; the menu planner's recorded drafts), so a run costs nothing and repeats exactly. The
 * real catalogue is used when the index and the partner key are there, with a handful of live price lookups.
 *
 *  1 a visitor kitchen is created (QR join with a software passkey)
 *  2 a typed request ("1,000 litres of lactose-free milk by Monday"): the mistake check, options, a fixed price,
 *    the gate, sign-off with the visitor's passkey, a signed confirmation
 *  3 alternatives from the product knowledge map, within the kitchen's rules (the assistant panel)
 *  4 a follow-up "same again but 200 litres" read against the earlier request, memory applied without asking
 *  5 a menu request becomes one multi-line order (the menu planner)
 *  6 a photo of a whiteboard becomes one order (the photo door's list through the planner)
 *  7 an outside agent over MCP places an order that stops for sign-off; its relayed confirmation is unverified
 *  8 a consumer assistant over the kitchen's connector address places an order that stops for sign-off
 *  9 a presenter enrols as that built-in demo kitchen's approver and signs the waiting order with a passkey
 * 10 the wholesaler suspends the kitchen: refused on every door (typed, REST, MCP, connector, photo, planner, voice)
 * 11 the ledger verifies, every request names its door, and the wholesaler's audit shows no private memory
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { kaariMandate } from "../qa/lib/actors";
import { KITCHEN_ORG } from "@/server/demo-kitchen";
import { loadLocalEnv } from "./lib/env";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const LIVE = flag("--live");
const SEED = flag("--seed");
const T0 = Date.now();

// ---------- HTTP with cookies ----------

let BASE = opt("--url") ?? "";
let calls = 0;
class Browser {
  constructor(private jar: Record<string, string> = {}) {}
  cookie(): string {
    return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; text: string }> {
    calls++;
    const isForm = body instanceof FormData;
    const res = await fetch(new URL(p, BASE), {
      method,
      headers: { accept: "application/json", ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}), ...(this.cookie() ? { cookie: this.cookie() } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const text = await res.text();
    let parsed: Json;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed, text };
  }
  get = (p: string, h?: Record<string, string>) => this.req("GET", p, undefined, h);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req("POST", p, b ?? {}, h);
  /** One call to Dock's v1 API through a kitchen console's back end (the store's agent). */
  call = (kitchen: string, method: "GET" | "POST", p: string, body?: unknown) => this.post(`/ui-api/kitchens/${kitchen}/call`, { method, path: p, body });
}

// ---------- the run ----------

type Outcome = { ok: boolean | "skip"; detail: string };
const results: { n: number; name: string; ok: boolean | "skip"; detail: string; ms: number }[] = [];
async function step(n: number, name: string, fn: () => Promise<Outcome>) {
  const t = Date.now();
  let out: Outcome;
  try {
    out = await fn();
  } catch (err) {
    out = { ok: false, detail: `threw: ${(err as Error).message.slice(0, 300)}` };
  }
  const ms = Date.now() - t;
  results.push({ n, name, ...out, ms });
  const tag = out.ok === "skip" ? "SKIP" : out.ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${String(n).padStart(2)}  ${name}  (${(ms / 1000).toFixed(1)} s)\n        ${out.detail}`);
}
const check = (cond: unknown, detail: string, why: string): Outcome => (cond ? { ok: true, detail } : { ok: false, detail: `${why}. ${detail}` });

/** Drive an intake to a quote the way a kitchen person would, through the console: confirm checks, take the first answers, the pre-selected card. */
async function toQuote(b: Browser, kitchen: string, step0: Json, log: string[]): Promise<Json> {
  let s = step0;
  for (let i = 0; i < 8 && s; i++) {
    if (s.state === "needs_confirmation") {
      log.push(`checked: ${s.concerns.map((c: Json) => c.code).join(", ")}`);
      s = (await b.call(kitchen, "POST", `/api/v1/intake/${s.requestId}/concerns`, { by: "the buyer", responses: s.concerns.map((c: Json) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) })).body?.step;
    } else if (s.state === "needs_input") {
      log.push(`asked: ${s.questions.map((q: Json) => q.text).join(" / ")}`);
      s = (await b.call(kitchen, "POST", `/api/v1/intake/${s.requestId}/answers`, { by: "the buyer", answers: s.questions.map((q: Json) => ({ questionId: q.id, optionId: q.options[0].id })) })).body?.step;
    } else if (s.state === "options_ready") {
      log.push(`options: ${s.options.map((o: Json) => `${o.rank} ${o.title} €${(o.totalCents / 100).toFixed(2)}${o.alternative ? ` [${o.alternative.tier} alternative]` : ""}`).join(" | ")}`);
      s = (await b.call(kitchen, "POST", `/api/v1/intake/${s.requestId}/choice`, { by: "the buyer", optionId: s.preselected?.optionId ?? s.options[0].optionId })).body?.step;
    } else break;
  }
  return s;
}

async function main() {
  loadLocalEnv();
  let server: ChildProcess | undefined;
  const passcode = `demo-all-${Math.random().toString(36).slice(2, 10)}`;
  if (!BASE) {
    const port = await freePort();
    BASE = `http://localhost:${port}`;
    const rec = path.resolve("scripts/demo-all/recordings.json");
    const env: Record<string, string | undefined> = {
      ...process.env,
      PORT: String(port),
      DOCK_RATE_LIMITS: "off",
      DOCK_OPS_PASSCODE: passcode,
      DOCK_PUBLIC_URL: "",
      DOCK_AIVEN: undefined,
      DOCK_MEMORY_LLM: "off",
      DOCK_VOICE: "off",
      ...(SEED ? { DOCK_CATALOG: "seed" } : {}),
      ...(LIVE ? {} : { DOCK_SCRIPTED_MODELS: "1", DOCK_SCRIPTED_RECORDINGS: rec, DOCK_INTERPRET_MODEL: "scripted:demo", DOCK_SCAN_MODEL: "scripted:demo", DOCK_ASSISTANT_MODEL: "scripted:demo", DOCK_MENU_MODEL: "recorded" }),
    };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port)], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    server.stderr?.on("data", (d) => (err = (err + String(d)).slice(-2000)));
    const up = await waitFor(`${BASE}/api/v1`, 40_000);
    if (!up) {
      console.error(`The server did not start on ${BASE} (run pnpm build first). ${err}`);
      server.kill();
      process.exit(1);
    }
    console.log(`Dock on ${BASE} (pid ${server.pid}), ${LIVE ? "live models" : "recorded model answers, no model spend"}, ${SEED ? "seed catalogue" : "the catalogue the server finds"}.\n`);
  } else console.log(`Against ${BASE}; its own model and catalogue settings apply. Ops steps need --passcode.\n`);
  const opsPasscode = opt("--passcode") ?? passcode;

  try {
    await run(opsPasscode);
  } finally {
    if (server?.pid) server.kill("SIGTERM"); // only the server this script started, by its own handle
  }
  const failed = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === "skip");
  console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped, ${calls} HTTP calls, ${((Date.now() - T0) / 1000).toFixed(0)} s.`);
  process.exit(failed.length ? 1 : 0);
}

async function run(passcode: string) {
  const visitor = new Browser();
  const auth = new SoftwareAuthenticator(new URL(BASE).origin);
  let sandbox = "";
  const orders: { orderId: string; requestId: string }[] = [];
  const health = (await new Browser().get("/api/health")).body;
  const realCatalogue = health?.catalog?.source === "valio";

  await step(1, "A visitor kitchen is created (QR join, software passkey)", async () => {
    const begin = await visitor.post("/api/v1/join", {});
    if (begin.status !== 200) return { ok: false, detail: `join ${begin.status}: ${begin.text.slice(0, 200)}` };
    const done = await visitor.post("/api/v1/join/verify", { response: auth.register(begin.body.options, new URL(BASE).origin) });
    sandbox = done.body?.sandbox?.sandboxId ?? "";
    return check(done.status === 201 && sandbox, `${done.body?.sandbox?.kitchenName} (${sandbox}), approver ${done.body?.sandbox?.approverName}, per-order limit €${((done.body?.sandbox?.perOrderLimitCents ?? 0) / 100).toFixed(0)}`, `verify ${done.status}`);
  });

  let first: Json;
  await step(2, "Typed request: mistake check, options, fixed price, gate, passkey sign-off", async () => {
    const text = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
    const read = await visitor.call(sandbox, "POST", "/api/v1/agent/interpret", { text });
    if (read.status !== 200) return { ok: false, detail: `interpret ${read.status}: ${read.text.slice(0, 200)}` };
    const opened = await visitor.call(sandbox, "POST", "/api/v1/intake", { need: read.body.need, by: "the buyer" });
    const log: string[] = [`read by ${read.body.model}: ${read.body.need.quantity.amount} ${read.body.need.quantity.unit} ${read.body.need.item.text} by ${read.body.need.deliverBy}`];
    const s = await toQuote(visitor, sandbox, opened.body?.step, log);
    first = { requestId: opened.body?.step?.requestId, text, need: read.body.need };
    if (s?.state !== "quoted") return { ok: false, detail: `${log.join("; ")}; ended ${s?.state}: ${(s?.notes ?? []).join(" ")}` };
    // The mistake check always runs; it speaks only when the amount, unit, date or a rule looks wrong for this kitchen.
    const flagged = log.some((l) => l.startsWith("checked")) || JSON.stringify(s).includes("Check the amount");
    const usual = (await visitor.call(sandbox, "GET", "/api/v1/kitchen")).body;
    const milk = (usual?.kitchen ?? usual)?.families?.find((f: Json) => f.family === "milk");
    if (!flagged) log.push(`mistake check: nothing unusual (${milk ? `${milk.usual.text.replace(/^usually/i, "this kitchen usually orders")}` : "no earlier milk orders"})`);
    const checked = flagged || !!milk;
    log.push(`fixed price €${(s.quote.quote.totalCents / 100).toFixed(2)} until ${s.quote.quote.expiresAt.slice(11, 16)} UTC; gate preview ${s.quote.policyPreview.outcome}`);
    const placed = await visitor.call(sandbox, "POST", "/api/v1/orders", { requestId: s.requestId });
    const order = placed.body?.order ?? placed.body;
    if (order?.status !== "pending_approval") return { ok: false, detail: `${log.join("; ")}; placed ${placed.status} ${order?.status ?? placed.text.slice(0, 200)}` };
    orders.push({ orderId: order.orderId, requestId: s.requestId });
    const approvalId = order.approval.approvalId;
    const ch = await visitor.post(`/api/v1/approvals/${approvalId}/challenge`, { decision: "approve" });
    const signed = await visitor.post(`/api/v1/approvals/${approvalId}`, { decision: "approve", proof: { kind: "webauthn", response: auth.assert(ch.body.options, { origin: new URL(BASE).origin }) } });
    const final = signed.body?.order;
    log.push(`gate: ${order.decision.reasons[0]?.slice(0, 90)}; signed with the passkey: ${final?.status}, confirmation ${final?.confirmation ? "JWS present" : "missing"}`);
    return check(checked && final?.status === "committed" && final.confirmation, log.join("; "), checked ? "not committed" : "no mistake check ran on 1,000 L");
  });

  await step(3, "Alternatives from the product knowledge map, within the kitchen's rules (assistant panel)", async () => {
    if (!realCatalogue) return { ok: "skip", detail: "the seed catalogue has no knowledge map (run without --seed)" };
    const kaari = new Browser();
    const r = await kaari.post("/ui-api/kitchens/kaari/assistant", { question: "Suggest a substitute for this cream for whipping desserts.", productId: "469050", screen: "the product page of 469050" });
    const products = (r.body?.citations ?? []).filter((c: Json) => c.kind === "product");
    return check(r.status === 200 && products.length > 0 && /product map/i.test(r.body.answer), `${r.body?.answer?.slice(0, 260)}`, `assistant ${r.status}, ${products.length} ranked products`);
  });

  await step(4, "Follow-up \"same again but 200 litres\" read against the earlier request; memory applied without asking", async () => {
    const earlier = [{ id: first.requestId, at: new Date().toISOString(), text: first.text, need: { item: first.need.item, quantity: first.need.quantity, deliverBy: first.need.deliverBy, optimise: first.need.optimise }, ordered: "1,000 L lactose-free milk", deliveredOn: null }];
    const read = await visitor.call(sandbox, "POST", "/api/v1/agent/interpret", { text: "same again but 200 litres", earlier });
    if (read.status !== 200) return { ok: false, detail: `interpret ${read.status}: ${read.text.slice(0, 200)}` };
    const opened = await visitor.call(sandbox, "POST", "/api/v1/intake", { need: read.body.need, by: "the buyer" });
    const s = opened.body?.step;
    const mem = [...(s?.memoryUsed ?? []).map((m: Json) => m.text), ...(s?.fromMemory ?? []).map((m: Json) => m.text)];
    return check(
      read.body.basedOn?.requestId === first.requestId && read.body.need.quantity.amount === 200 && s?.requestId,
      `based on ${read.body.basedOn?.requestId} (fields ${read.body.basedOn?.fields?.join(", ")}); 200 L ${read.body.need.item.text}; step ${s?.state}; memory: ${mem.length ? mem.join(" | ").slice(0, 200) : "no remembered item needed"}`,
      "not read against the earlier request",
    );
  });

  const kaari = new Browser();
  let signMe: Json;
  await step(5, "A menu request becomes one multi-line order (menu planner)", async () => {
    const r = await kaari.post("/ui-api/plan/kaari", { text: "Salmon soup for 300 on Friday" });
    if (r.status !== 201) return { ok: false, detail: `plan ${r.status}: ${r.text.slice(0, 200)}` };
    const out = await planToOrder(kaari, r.body);
    if (out.order) orders.push({ orderId: out.order.orderId, requestId: r.body.requestId });
    if (out.order && out.lines < 2 && !realCatalogue) return { ok: "skip", detail: `the seed catalogue sells too few of the dish's ingredients for a multi-line order: ${out.detail}` };
    return check(out.order && out.lines >= 2, `${r.body.model.id}: ${out.detail}`, "no multi-line order");
  });

  await step(6, "A photo of a whiteboard becomes one order (photo door, list through the planner)", async () => {
    const form = new FormData();
    form.append("file", new Blob([readFileSync("eval/scan/01-whiteboard-en.jpg")], { type: "image/jpeg" }), "whiteboard.jpg");
    const scan = await kaari.req("POST", "/ui-api/scan/kaari", form);
    if (scan.status !== 200) return { ok: false, detail: `scan ${scan.status}: ${scan.text.slice(0, 200)}` };
    const ready = (scan.body.lines ?? []).filter((l: Json) => l.item && l.amount && l.unit && l.status !== "instruction" && l.status !== "not_an_item");
    const list = await kaari.post("/ui-api/plan/kaari/list", { items: ready.map((l: Json) => ({ item: l.item, amount: l.amount, unit: l.unit })), source: "image" });
    if (list.status !== 201) return { ok: false, detail: `list ${list.status}: ${list.text.slice(0, 200)}` };
    const out = await planToOrder(kaari, list.body);
    if (out.order) orders.push({ orderId: out.order.orderId, requestId: list.body.requestId });
    return check(out.order && out.lines >= 2, `read ${ready.length} lines (${ready.map((l: Json) => `${l.amount} ${l.unit} ${l.item}`).join(", ")}) by ${scan.body.model}; one plan: ${out.detail}`, "the list did not become one order");
  });

  const day = first?.need?.deliverBy;
  const milkNeed = (amount: number) => ({ need: { text: `${amount} L lactose-free milk`, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount, unit: "L" }, ...(day ? { deliverBy: day } : {}) } });
  await step(7, "An outside agent over MCP: order stops for sign-off; a relayed confirmation is unverified", async () => {
    const mandate = await kaariMandate();
    const client = new Client({ name: "outside-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { requestInit: { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": String(KITCHEN_ORG.agentId) } } }));
    const r = await driveMcp(client, milkNeed(1000));
    await client.close();
    if (r.order && r.requestId) orders.push({ orderId: r.order.orderId, requestId: r.requestId });
    const hc = r.order?.decision?.rules?.find((x: Json) => x.rule === "human_confirmation");
    return check(r.order?.status === "pending_approval" && hc?.outcome === "escalate", `${r.log.join("; ")}; human_confirmation: ${hc?.outcome} (${hc?.reason?.slice(0, 120)})`, "not stopped for sign-off with the relayed confirmation unverified");
  });

  await step(8, "A consumer assistant over the kitchen's connector address: order stops for sign-off", async () => {
    const c = await kaari.get("/ui-api/connect/kaari");
    const url = c.body?.connector?.url;
    if (!url) return { ok: false, detail: `connector ${c.status}: ${c.text.slice(0, 200)}` };
    const client = new Client({ name: "chat-assistant", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(new URL(url).pathname, BASE), { requestInit: { headers: { "user-agent": "Claude-User/1.0" } } }));
    const r = await driveMcp(client, milkNeed(600));
    await client.close();
    if (r.order && r.requestId) orders.push({ orderId: r.order.orderId, requestId: r.requestId });
    signMe = r.order;
    return check(r.order?.status === "pending_approval", `${r.log.join("; ")}; waits for ${r.order?.approval?.approver?.name}`, "did not stop for sign-off");
  });

  await step(9, "A presenter enrols as the built-in demo kitchen's approver and signs its waiting order with a passkey", async () => {
    if (!signMe?.approval) return { ok: signMe ? "skip" : false, detail: signMe ? `the order did not need sign-off (${signMe.status})` : "no waiting order from step 8" };
    const phone = new Browser();
    const presenter = new SoftwareAuthenticator(new URL(BASE).origin);
    const begin = await phone.post("/ui-api/presenter/enrol", { kitchen: "kaari", role: signMe.approval.approver.role, passcode, presenter: "demo:all" });
    if (begin.status !== 200) return { ok: false, detail: `enrol ${begin.status}: ${begin.text.slice(0, 200)}` };
    const done = await phone.post("/ui-api/presenter/enrol/verify", { response: presenter.register(begin.body.options, new URL(BASE).origin) });
    if (done.status !== 201) return { ok: false, detail: `enrol verify ${done.status}: ${done.text.slice(0, 200)}` };
    const home = await phone.get("/api/v1/approver");
    const id = signMe.approval.approvalId;
    const ch = await phone.post(`/api/v1/approvals/${id}/challenge`, { decision: "approve" });
    const signed = await phone.post(`/api/v1/approvals/${id}`, { decision: "approve", proof: { kind: "webauthn", response: presenter.assert(ch.body.options, { origin: new URL(BASE).origin }) } });
    return check(home.status === 200 && signed.body?.order?.status === "committed", `enrolled for ${begin.body.approver.name} (${begin.body.approver.role}); approver home ${home.status} with ${home.body?.pending?.length ?? 0} waiting; signed: ${signed.body?.order?.status}`, `home ${home.status}, sign ${signed.status} ${signed.text.slice(0, 150)}`);
  });

  const ops = new Browser();
  await step(10, "The wholesaler suspends the kitchen: refused on every door", async () => {
    const signin = await ops.post("/ops-api/session", { passcode, name: "demo:all" });
    if (signin.status !== 200) return { ok: false, detail: `ops sign-in ${signin.status}` };
    const s = await ops.post("/ops-api/control", { action: "suspend", scope: "org", target: KITCHEN_ORG.orgId, reason: "demo:all: suspended to show every door refuses" });
    if (s.status !== 201) return { ok: false, detail: `suspend ${s.status}: ${s.text.slice(0, 200)}` };
    const mandate = await kaariMandate();
    const door = new Browser();
    const tries: [string, () => Promise<{ status: number; text: string }>][] = [
      ["typed", () => door.call("kaari", "POST", "/api/v1/intake", milkNeed(50))],
      ["REST", () => door.post("/api/v1/intake", milkNeed(50), { authorization: `Mandate ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId })],
      ["MCP", async () => mcpStatus(new URL("/api/mcp", BASE), { authorization: `Bearer ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId })],
      ["connector", async () => mcpStatus(new URL(new URL((await door.get("/ui-api/connect/kaari")).body.connector.url).pathname, BASE), {})],
      ["photo", () => door.post("/ui-api/scan/kaari/step", { action: "open", line: { id: "l1", read: "Milk 20 L", item: "milk", amount: 20, unit: "L", confidence: "high", edited: false }, source: "image" })],
      ["menu planner", () => door.post("/ui-api/plan/kaari/list", { items: [{ item: "milk", amount: 20, unit: "L" }, { item: "cream", amount: 5, unit: "L" }] })],
      ["voice", () => door.post("/ui-api/voice/kaari/call", { mode: "typed" })],
    ];
    const seen: string[] = [];
    let all = true;
    for (const [name, f] of tries) {
      const r = await f();
      const refused = r.status >= 400 && /suspend/i.test(r.text);
      all &&= refused;
      seen.push(`${name} ${r.status}${refused ? "" : ` NOT refused: ${r.text.slice(0, 80)}`}`);
    }
    await ops.post("/ops-api/control", { action: "resume", suspensionId: s.body.suspension.suspensionId, note: "demo:all done" });
    return check(all, seen.join(", "), "a door let the suspended kitchen through");
  });

  await step(11, "The ledger verifies, each request names its door, and the wholesaler's audit shows no private memory", async () => {
    const v = (await new Browser().get("/api/v1/ledger")).body?.verification;
    const memory = (await kaari.get("/ui-api/memory/kitchens/kaari")).body;
    const kaariProfile = (await kaari.call("kaari", "GET", "/api/v1/kitchen")).body;
    const privateTexts = [...(memory?.items ?? []).filter((m: Json) => m.audience !== "shared").map((m: Json) => m.text), ...(kaariProfile?.kitchen?.stated ?? kaariProfile?.stated ?? []).map((s: Json) => s.text)].filter((t: string) => t && t.length > 6);
    const leaks: string[] = [];
    const doors: string[] = [];
    for (const o of orders) {
      const audit = await ops.get(`/ops-api/audit/${o.orderId}`);
      const trace = await ops.get(`/ops-api/trace/${o.requestId}`);
      for (const t of privateTexts) if (audit.text.includes(t) || trace.text.includes(t)) leaks.push(`${o.orderId}: "${t}"`);
      doors.push(trace.body?.trace?.doorText ?? trace.body?.doorText ?? "?");
    }
    return check(v?.ok && leaks.length === 0 && !doors.includes("?"), `chain of ${v?.length} entries verifies; doors: ${doors.join(", ")}; ${privateTexts.length} private memory texts checked against ${orders.length} orders' audit and trace: ${leaks.length ? leaks.join("; ") : "none shown"}`, v?.ok ? (leaks.length ? "private memory in the wholesaler's view" : "a request without its door") : "ledger does not verify");
  });
}

/** A plan to an order: decide each open doubt (accept it where Dock offers that, otherwise strike the line), quote, order. */
async function planToOrder(b: Browser, plan0: Json): Promise<{ order?: Json; lines: number; detail: string }> {
  let plan = plan0;
  for (let i = 0; i < 40 && plan.pending; i++) {
    await new Promise((r) => setTimeout(r, 500));
    plan = (await b.get(`/ui-api/plan/kaari/${plan.planId}`)).body;
  }
  const edits: Json[] = [];
  for (const l of plan.lines ?? []) {
    const open = (l.doubts ?? []).filter((d: Json) => !d.accepted);
    if (!open.length) continue;
    if (open.every((d: Json) => d.acceptLabel)) for (const d of open) edits.push({ op: "accept", doubtId: d.doubtId });
    else edits.push({ op: "strike", lineId: l.lineId, struck: true });
  }
  if (edits.length) plan = (await b.post(`/ui-api/plan/kaari/${plan.planId}`, { edits })).body;
  const q = await b.post(`/ui-api/plan/kaari/${plan.planId}/quote`);
  if (q.status !== 200) return { lines: 0, detail: `quote ${q.status}: ${q.text.slice(0, 200)}` };
  const o = await b.post(`/ui-api/plan/kaari/${plan.planId}/order`);
  const order = o.body?.order;
  const lines = o.body?.quote?.lines?.length ?? q.body?.quote?.lines?.length ?? 0;
  return { order: order && { ...order, approval: order.approvalId ? { approvalId: order.approvalId, approver: order.approver } : order.approval }, lines, detail: `${plan.lines?.length ?? 0} plan lines (${edits.length} decided), one quote of ${lines} lines €${((q.body?.quote?.totalCents ?? 0) / 100).toFixed(2)}, one order ${order?.status ?? o.status}` };
}

async function driveMcp(client: Client, need: Json): Promise<{ order?: Json; requestId?: string; log: string[] }> {
  const call = async (name: string, a: Json) => ((await client.callTool({ name, arguments: a })) as CallToolResult).structuredContent as Json;
  const log: string[] = [];
  let r = await call("submit_need", { ...need, by: "the buyer" });
  const requestId = r?.step?.requestId;
  for (let i = 0; i < 6 && r?.step && r.step.state !== "quoted"; i++) {
    const s = r.step;
    if (s.state === "needs_confirmation") {
      log.push(`relayed a confirmation of ${s.concerns.map((c: Json) => c.code).join(", ")}`);
      r = await call("respond_to_concerns", { requestId, by: "the buyer", relay: true, responses: s.concerns.map((c: Json) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) });
    } else if (s.state === "needs_input") {
      r = await call("answer_questions", { requestId, by: "the buyer", relay: true, answers: s.questions.map((q: Json) => ({ questionId: q.id, optionId: q.options[0].id })) });
    } else if (s.state === "options_ready") {
      log.push(`${s.options.length} options`);
      r = await call("choose_option", { requestId, by: "the buyer", relay: true, optionId: s.preselected?.optionId ?? s.options[0].optionId });
    } else break;
  }
  if (r?.step?.state !== "quoted") return { requestId, log: [...log, `ended ${r?.step?.state ?? r?.error?.code}: ${(r?.step?.notes ?? [r?.error?.message]).join(" ").slice(0, 200)}`] };
  const placed = await call("place_order", { requestId });
  log.push(`placed by request id: ${placed?.order?.status ?? placed?.error?.code}`);
  return { order: placed?.order, requestId, log };
}

async function mcpStatus(url: URL, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  const client = new Client({ name: "probe", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    const r = (await client.callTool({ name: "submit_need", arguments: { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 20, unit: "L" } } } })) as CallToolResult;
    const s = r.structuredContent as Json;
    return { status: s?.ok === false ? 403 : 200, text: JSON.stringify(s?.error ?? s).slice(0, 300) };
  } catch (err) {
    return { status: 403, text: (err as Error).message };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function waitFor(url: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

void main();
