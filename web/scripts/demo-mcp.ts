/**
 * Valio Aimo's headline example, sent by an outside agent: a hotel chain's purchasing agent that is not ours. It is
 * the stock MCP TypeScript client, `@modelcontextprotocol/client`, and a scripted agent (no LLM). It knows only one
 * address and nothing AimoPilot-specific.
 *
 *   pnpm build && pnpm demo:mcp              starts `next start` on a free port, runs, stops it (the default)
 *   pnpm demo:mcp --url http://localhost:3100   against a server you run (or DOCK_URL)
 *   pnpm demo:mcp --headline                 the headline only, without the four exception scenarios
 *
 * The story:
 *   1  the hotel's purchasing manager joins on her phone (a passkey): AimoPilot makes the hotel's kitchen, with her as
 *      the person who signs above the agent's limit, and hands the hotel's agent one address (the connector)
 *   2  the agent discovers the open interface (RFC 9727 catalogue), connects over MCP, lists the tools, reads its mandate
 *   3  "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price
 *      and availability": find_products returns products, prices and availability in structured form
 *   4  submit_need: AimoPilot's checks, at most two questions (asked through the client's form), good/better/best options
 *   5  choose_option (a signed fixed price) and place_order: over the agent's €500 limit, so it waits for their sign-off
 *   6  the agent tries to misbehave (order again, scan the catalogue live): the gate refuses each with its rule
 *   7  she signs on their phone with their passkey; await_decision lets the agent learn the outcome the moment they do
 *   8  the receipt verifies with the wholesaler's published keys; explain is the audit trail both sides read
 * Then the partner's exception scenarios, as the same outside agent (a second hotel, so the first's allowance is its own):
 *   A  a stock-out with a substitute (find_alternatives: good, better, best with trade-offs and the gate's preview)
 *   B  a substitution that must respect allergen rules (the gate refuses a nut drink; the alternatives keep the rules)
 *   C  a request that cannot be met in time (today's delivery: past the cut-off; the intake says so)
 *   D  an order placed alone, then taken back before the cut-off (withdraw_order)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { addDaysIso, localNow, nextDeliveryDay } from "@/core/kitchen";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { loadLocalEnv } from "./lib/env";
import { verifySigned } from "./lib/verify-receipt";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
let BASE = opt("--url") ?? process.env.DOCK_URL ?? "";
const HEADLINE_ONLY = args.includes("--headline");

const say = (s = "") => console.log(s);
const step = (tag: string, s: string) => say(`\n[${tag}] ${s}`);
const indent = (lines: string[]) => lines.forEach((l) => say("      " + l));
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fail = (why: string): never => {
  throw new Error(why);
};

// ---------- the hotel's purchasing manager: a phone with a passkey (a software one here) ----------

class Phone {
  private jar: Record<string, string> = {};
  readonly passkey = new SoftwareAuthenticator(new URL(BASE).origin);
  async req(method: string, p: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(new URL(p, BASE), {
      method,
      headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  /** Join by QR: a fresh hotel kitchen, with this phone's passkey as the person who signs above the agent's limit. */
  async join() {
    const begin = await this.req("POST", "/api/v1/join", {});
    if (begin.status !== 200) fail(`join: HTTP ${begin.status} ${JSON.stringify(begin.body)}`);
    const done = await this.req("POST", "/api/v1/join/verify", { response: this.passkey.register(begin.body.options, new URL(BASE).origin) });
    if (done.status !== 201) fail(`join: HTTP ${done.status} ${JSON.stringify(done.body)}`);
    return done.body.sandbox as { sandboxId: string; kitchenName: string; city: string; approverName: string; perOrderLimitCents: number };
  }
  /** Sign off on the phone: a passkey assertion bound to this exact order's digest. */
  async signOff(approvalId: string) {
    const ch = await this.req("POST", `/api/v1/approvals/${approvalId}/challenge`, { decision: "approve" });
    if (ch.status !== 200) fail(`challenge: HTTP ${ch.status} ${JSON.stringify(ch.body)}`);
    return this.req("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", proof: { kind: "webauthn", response: this.passkey.assert(ch.body.options, { origin: new URL(BASE).origin }) } });
  }
}

// ---------- the hotel's agent: generic MCP from here on ----------

type Result = { ok: boolean; nextStep: string; error?: { code: string; rule?: string; message: string } } & Json;

async function agentFor(url: string, buyer: string) {
  // Declaring elicitation lets AimoPilot ask the person through the client's form, not through the agent.
  const client = new Client({ name: "hotel-chain-purchasing-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" }, capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler("elicitation/create", async (req) => {
    const form = req.params as unknown as { message: string; requestedSchema: { properties: Record<string, { title?: string; oneOf?: { const: string; title: string }[] }> } };
    const content: Record<string, string> = { by: buyer };
    for (const [key, f] of Object.entries(form.requestedSchema.properties)) {
      if (!f.oneOf) continue;
      const pick = f.oneOf.find((o) => o.const === "confirm") ?? f.oneOf.find((o) => o.const === "price") ?? f.oneOf[0];
      content[key] = pick.const;
      indent([`${buyer}'s screen (AimoPilot asks the person through the client, not the agent): ${form.message}`, `  ${f.title}: (x) ${pick.title}`]);
    }
    return { action: "accept", content };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const call = async (name: string, a: Record<string, unknown> = {}): Promise<Result> => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    return (r.structuredContent as Result) ?? { ok: false, nextStep: "", error: { code: "invalid_arguments", message: (r.content[0] as { text: string }).text } };
  };
  return { client, call };
}

/** The partner's own reason, short: "stock unknown, cut-off 2026-11-12 15:00 passed". */
const why = (u: Json) => {
  const cut = /order cut-off (\S+) has passed/.exec(u.reason ?? "")?.[1];
  const probs = (u.problems ?? []).filter((x: string) => x !== "cutoff_passed").map((x: string) => x.replaceAll("_", " "));
  return [...probs, ...(cut ? [`order cut-off ${cut.slice(0, 16).replace("T", " ")} passed`] : [])].join(", ") || String(u.reason ?? "").split(";")[0];
};
const liveLine = (p: Json) =>
  `${(p.match ? `[${p.match}] ` : "").padEnd(10)}${p.name} (${p.brand}), ${p.pack.size} ${p.pack.unit}: ${p.live ? `${eur(p.live.unitPriceCents)}/pack, ${eur(p.live.perUnit.cents)}/${p.live.perUnit.unit}, stock ${p.live.availablePacks ?? "not reported"}, earliest ${p.live.earliestDelivery}${p.live.orderBy ? `, order by ${p.live.orderBy.replace("T", " ")}` : ""}${p.live.meetsDay === undefined ? "" : p.live.meetsDay ? ", makes the day" : ", misses the day"}${p.live.packsForQuantity ? `; ${p.live.packsForQuantity} packs = ${eur(p.live.lineTotalCents)}${p.live.coversQuantity === false ? ", stock does not cover it" : ""}` : ""}` : p.unavailable ? `not orderable: ${why(p.unavailable)}` : "no live price"}; reliability ${p.deliveryReliability ?? "unknown"}, CO2 ${p.carbon.kgCo2ePerUnit ?? "unknown"} kg/${p.carbon.unit} (${p.carbon.basis.replaceAll("_", " ")})`;

async function headline() {
  say(`An outside agent, a hotel chain's, against ${BASE}`);
  const phone = new Phone();
  const hotel = await phone.join();
  step("join", `${hotel.approverName}, purchasing manager of ${hotel.kitchenName} (${hotel.city}), joins on their phone with a passkey. The hotel's agent may order alone up to ${eur(hotel.perOrderLimitCents)}; above that they sign.`);
  const connect = await phone.req("GET", `/ui-api/connect/${hotel.sandboxId}`);
  const address: string | undefined = connect.body?.connector?.url;
  if (!address) fail(`no connector address: HTTP ${connect.status}`);
  // The address carries the server's public base; this run talks to BASE.
  const url = new URL(new URL(address!).pathname, BASE).href;
  step("address", `The hotel hands its agent one address: ${new URL(address!).origin}/api/mcp/c/dk_… (the mandate stays on the server; no tool can approve).`);

  const catalog = await (await fetch(new URL("/.well-known/api-catalog", BASE))).json();
  step("discover", `GET /.well-known/api-catalog (RFC 9727): ${catalog.linkset.map((l: Json) => new URL(l.anchor).pathname).join(", ")}`);

  const { client, call } = await agentFor(url, hotel.approverName);
  const sv = client.getServerVersion();
  const { tools } = await client.listTools();
  step("connect", `${sv?.title ?? sv?.name} ${sv?.version}, MCP ${client.getNegotiatedProtocolVersion()}, ${tools.length} tools; ${tools.filter((t) => t._meta?.["dock/humanInput"]).map((t) => t.name).join(" and ")} carry the buyer's own answer. None approves.`);

  const { mandate: m } = await call("read_mandate");
  step("mandate", `Buying for ${m.issuer.name}: ${m.allowedCategories.join(", ")}; must be ${m.requiredAttributes.join(", ") || "anything"}; never ${m.forbiddenAllergens.join(", ")}; alone up to ${eur(m.perOrderLimitCents)}, weekly cap ${eur(m.weeklyBudgetCents)}; substitutes: ${m.substitution.rule.replaceAll("_", " ")}; above the limit ${m.approvers.map((a: Json) => a.name).join(", ")} signs.`);

  const monday = nextDeliveryDay(addDaysIso(localNow(new Date()).date, 1), [1])!;
  const text = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
  step("request", `"${text}" (Monday is ${monday})`);
  const look = await call("find_products", { text: "lactose-free milk", category: "milk", requiredClaims: ["lactose_free"], quantity: { amount: 1000, unit: "L" }, deliverOn: monday, limit: 4 });
  if (!look.ok) fail(`find_products: ${look.error?.message}`);
  step("lookup", `find_products: ${look.matched} match in the assortment inside the mandate (${look.outsideMandate.count} more outside it); live price, stock and delivery for ${look.liveChecked}:`);
  indent(look.products.map(liveLine));

  let r = await call("submit_need", { need: { text, item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 1000, unit: "L" }, deliverBy: monday, optimise: "price" }, by: hotel.approverName });
  if (!r.ok) fail(`submit_need: ${r.error?.message}`);
  const requestId: string = r.step.requestId;
  step("need", `submit_need: ${requestId} is ${r.step.state} (waiting for: ${r.waitingFor}).`);
  for (let i = 0; i < 4 && (r.step.state === "needs_confirmation" || r.step.state === "needs_input"); i++) {
    if (r.step.state === "needs_confirmation") {
      indent(r.step.concerns.map((c: Json) => `check: ${c.message}`));
      const around = await call("request_quote", { requestId, lines: [{ productId: look.products[0].productId, quantity: 1 }] });
      indent([`the agent tries to quote around the check: refused, rule ${around.error?.rule}`]);
      r = await call("respond_to_concerns", { requestId });
    } else {
      indent(r.step.questions.map((q: Json) => `question: ${q.text}`));
      r = await call("answer_questions", { requestId });
    }
    if (!r.ok) fail(`${r.error?.code}: ${r.error?.message}`);
  }
  if (r.step.state !== "options_ready" && r.step.state !== "quoted") {
    step("stop", `${r.step.state}: ${r.nextStep}`);
    return { ok: false };
  }
  if (r.step.options?.length) step("options", `${r.step.options.length} options, good, better, best (live prices for a short list only):`);
  for (const o of (r.step.options ?? []) as Json[]) {
    indent([`${o.rank.padEnd(6)} ${o.title}: ${eur(o.totalCents)}, delivery ${o.deliveryDate}${o.orderBy ? `, order by ${o.orderBy.replace("T", " ")}` : ""}; gate: ${o.gate?.outcome ?? "?"}${o.match === "compromise" ? `; gives up: ${o.givesUp.map((g: Json) => g.text ?? g.code ?? JSON.stringify(g)).join(", ")}` : ""}`]);
    indent([...o.pros.slice(0, 2).map((x: string) => `         + ${x}`), ...o.cons.slice(0, 2).map((x: string) => `         - ${x}`), ...o.signOff.map((x: string) => `         ! ${x}`)]);
  }
  const optionId: string = r.step.quote?.optionId ?? r.step.preselected?.optionId ?? r.step.options[0].optionId;
  if (r.step.state === "options_ready") {
    r = await call("choose_option", { requestId, optionId, by: hotel.approverName });
    if (!r.ok) fail(`choose_option: ${r.error?.message}`);
  }
  const q = r.step.quote;
  step("quote", `${r.step.preselected?.reason ? `${r.step.preselected.reason} ` : ""}${hotel.approverName}'s pick, ${optionId}: signed fixed price ${eur(q.quote.totalCents)} until ${q.quote.expiresAt.slice(11, 16)} UTC; the gate's preview: ${q.policyPreview.outcome}.`);

  const placed = await call("place_order", { requestId });
  if (!placed.ok) fail(`place_order: ${placed.error?.rule}: ${placed.error?.message}`);
  const orderId: string = placed.order.orderId;
  step("order", `place_order { requestId }: ${placed.order.status}. ${placed.order.decision.reasons[0] ?? ""}`);
  indent([`nextStep: ${placed.nextStep}`]);

  const again = await call("place_order", { requestId });
  const scan = await call("check_availability", { requestId, productIds: Array.from({ length: 11 }, (_, i) => `X-${i}`) });
  step("misbehave", `Orders again anyway: refused (${again.error?.rule ?? again.error?.code}). Prices 11 products at once: refused (${scan.error?.rule ?? scan.error?.code ?? "input schema"}).`);

  if (placed.order.status === "pending_approval") {
    const t0 = Date.now();
    const waiting = call("await_decision", { orderId, seconds: 30 });
    await new Promise((res) => setTimeout(res, 1500));
    const signed = await phone.signOff(placed.order.approval.approvalId);
    step("sign-off", `${hotel.approverName} signs on their phone with their passkey (bound to this order's digest): HTTP ${signed.status}.`);
    const learned = await waiting;
    step("outcome", `await_decision: the agent learns it is ${learned.order.status} ${((Date.now() - t0) / 1000).toFixed(1)} s after it started waiting.`);
  }
  const final = await call("get_order", { orderId });
  if (final.order.status !== "committed") fail(`order ended ${final.order.status}`);
  const jwks = await (await fetch(new URL("/.well-known/jwks.json", BASE))).json();
  const receipt = await verifySigned(final.order.confirmation, jwks);
  const file = path.join(tmpdir(), `dock-receipt-${orderId}.json`);
  writeFileSync(file, JSON.stringify({ order: final.order }, null, 2));
  step("receipt", `Committed ${eur(final.order.totalCents)}. The receipt (${receipt.typ}) verifies with /.well-known/jwks.json, key ${receipt.kid}; authorised by ${JSON.stringify(receipt.payload.authorisedBy)}.`);
  indent([`check it yourself: pnpm verify:receipt ${file} --url ${BASE}`]);
  const ex = await call("explain", { requestId });
  step("audit", `explain: ${ex.explanation.length} lines, hash chain verified: ${ex.verification.ok}. The buyer's side and the wholesaler read the same record:`);
  indent(ex.explanation.slice(0, 14).map((l: string) => `- ${l}`));
  step("see it", `The wall: ${BASE}/   The operations trace (door: connector): ${BASE}/ops/trace/${requestId}`);
  await client.close();
  return { ok: true };
}

async function scenarios() {
  const phone = new Phone();
  const hotel = await phone.join();
  const connect = await phone.req("GET", `/ui-api/connect/${hotel.sandboxId}`);
  const { client, call } = await agentFor(new URL(new URL(connect.body.connector.url).pathname, BASE).href, hotel.approverName);
  say(`\n\n== The exception scenarios, as ${hotel.kitchenName}'s agent ==`);
  const monday = nextDeliveryDay(addDaysIso(localNow(new Date()).date, 1), [1])!;
  const results: string[] = [];

  // A: a stock-out with a substitute
  const look = await call("find_products", { text: "lactose-free milk", category: "milk", requiredClaims: ["lactose_free"], live: false, limit: 3 });
  const asked = look.products[0];
  const alt = await call("find_alternatives", { requestId: look.requestId, productId: asked.productId, quantity: { amount: 1000, unit: "L" }, deliverOn: monday });
  step("A stock-out", `${asked.name} for 1,000 L by ${monday}: ${alt.requested.live ? `stock ${alt.requested.live.availablePacks ?? "not reported"}, ${alt.requested.live.coversQuantity === false ? "does not cover it" : alt.requested.live.meetsDay === false ? "misses the day" : "covers it"}` : (alt.requested.unavailable ? why(alt.requested.unavailable) : "no live offer")}. find_alternatives (ranked by ${alt.rankedBy}):`);
  for (const a of alt.alternatives as Json[]) indent([`${a.rank.padEnd(6)} ${a.name}, ${a.packs} packs ${eur(a.totalCents)}; gate: ${a.gate.outcome}${a.gate.approver ? ` (${a.gate.approver.name} signs)` : ""}; ${a.tradeOffs.join("; ") || "no trade-offs"}${a.why ? `; ${a.why}` : ""}`]);
  if (alt.leftOut.length) indent([`left out: ${alt.leftOut.map((x: Json) => `${x.name}${x.rule ? ` (${x.rule})` : ""}`).join(", ")}`]);
  results.push(`A ${alt.alternatives.length ? "pass" : "none"}`);

  // B: allergen rules hold on a substitution. Master data (search_products) is not filtered by the mandate: the agent
  // finds a nut drink there and tries to slip it in as a substitute; the gate refuses it by rule.
  const nutIn = async (q: Record<string, unknown>) => ((await call("search_products", { requestId: look.requestId, limit: 20, ...q })).products ?? []).find((p: Json) => p.allergens?.includes("nuts"));
  const nut = (await nutIn({ text: "almond", category: "plant_drink" })) ?? (await nutIn({ text: "almond" }));
  if (nut) {
    const sneak = await call("request_quote", { requestId: look.requestId, lines: [{ productId: nut.id, quantity: 1, substituteFor: asked.productId }] });
    const placedSneak = sneak.ok ? await call("place_order", { requestId: look.requestId }) : sneak;
    step("B allergens", `The agent finds ${nut.name} (contains nuts) in master data and tries it as a substitute: ${sneak.ok ? `the quote's preview says ${sneak.policyPreview.outcome}; ` : ""}${placedSneak.ok ? `placed ${placedSneak.order.status}?!` : `refused, rule ${placedSneak.error?.rule}`}. find_products never offers it.`);
    results.push(`B ${placedSneak.ok ? "FAIL" : "pass"}`);
  } else {
    step("B allergens", "No nut product matched in this catalogue's master data; skipped the attempt.");
    results.push("B skip");
  }
  const safe = await call("find_alternatives", { requestId: look.requestId, productId: asked.productId, forbiddenAllergens: ["soy"], rankBy: "price" });
  indent([`find_alternatives without soy (and the mandate's ${hotel.kitchenName} rules): ${safe.alternatives.map((a: Json) => `${a.name} [${a.allergens.contains.join(", ") || "no allergens declared"}]`).join("; ") || safe.none || "none"}`]);

  // C: cannot be met in time
  const today = localNow(new Date()).date;
  const now = await call("find_products", { requestId: look.requestId, text: "lactose-free milk", category: "milk", requiredClaims: ["lactose_free"], deliverOn: today, limit: 3 });
  step("C too late", `Delivery today (${today}): ${now.products.map((p: Json) => `${p.name}: ${p.live ? `earliest ${p.live.earliestDelivery}${p.live.cutoffPassed ? ", cut-off passed" : ""}, ${p.live.meetsDay ? "makes it" : "misses it"}` : p.unavailable ? why(p.unavailable) : "no offer"}`).join("; ")}.`);
  const late = await call("submit_need", { need: { text: "100 L lactose-free milk for today", item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverOn: today }, by: hotel.approverName });
  indent([`submit_need for today: ${late.ok ? late.step.state : late.error?.code}${late.ok && late.step.options?.length ? `, earliest option ${late.step.options[0].deliveryDate}` : ""}. nextStep: ${(late.nextStep ?? "").slice(0, 220)}`]);
  results.push(`C ${now.products.every((p: Json) => !p.live?.meetsDay) ? "pass" : "makes it"}`);

  // D: placed alone, taken back before the cut-off
  let d = await call("submit_need", { need: { text: "20 L lactose-free milk for Monday", item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 20, unit: "L" }, deliverBy: monday, optimise: "price" }, by: hotel.approverName });
  for (let i = 0; i < 3 && d.ok && (d.step.state === "needs_confirmation" || d.step.state === "needs_input"); i++) d = await call(d.step.state === "needs_confirmation" ? "respond_to_concerns" : "answer_questions", { requestId: d.step.requestId });
  const alone = d.ok && d.step.state === "options_ready" ? (d.step.options as Json[]).find((o) => o.gate?.outcome === "auto_approve") : undefined;
  if (alone) d = await call("choose_option", { requestId: d.step.requestId, optionId: alone.optionId, by: hotel.approverName });
  if (d.ok && d.step.state === "quoted") {
    const o = await call("place_order", { requestId: d.step.requestId });
    const listed = await call("list_orders", { limit: 3 });
    const mine = listed.orders.find((x: Json) => x.orderId === o.order?.orderId);
    const back = o.ok ? await call("withdraw_order", { orderId: o.order.orderId, reason: "the breakfast was cancelled", by: hotel.approverName }) : o;
    step("D take back", `20 L, ${eur(o.order?.totalCents ?? 0)}: ${o.ok ? o.order.status : o.error?.rule}${o.order?.status === "committed" ? " by the agent alone" : ""}; list_orders says ${mine?.canTakeBack?.how ?? "no take-back"}${mine?.canTakeBack?.until ? ` (until ${mine.canTakeBack.until.slice(0, 16)})` : ""}; withdraw_order: ${back.ok ? back.order.status : `${back.error?.code}: ${back.error?.message}`}.`);
    results.push(`D ${back.ok ? "pass" : back.error?.code}`);
  } else {
    step("D take back", `No option the agent may place alone right now (${d.ok ? d.step.state : d.error?.code}); skipped.`);
    results.push("D skip");
  }
  await client.close();
  return results;
}

async function main() {
  loadLocalEnv();
  let server: ChildProcess | undefined;
  if (!BASE) {
    const port = await freePort();
    BASE = `http://localhost:${port}`;
    const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), DOCK_RATE_LIMITS: "off", DOCK_PUBLIC_URL: "", DOCK_AIVEN: undefined, DOCK_MEMORY_LLM: "off", DOCK_VOICE: "off" };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port)], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    server.stderr?.on("data", (d) => (err = (err + String(d)).slice(-2000)));
    if (!(await waitFor(`${BASE}/api/v1`, 60_000))) {
      console.error(`The server did not start on ${BASE}. Run pnpm build first. ${err}`);
      server.kill();
      process.exit(1);
    }
    say(`AimoPilot production build on ${BASE} (pid ${server.pid}, stopped at the end).`);
  }
  let code = 0;
  try {
    const h = await headline();
    if (!h.ok) code = 1;
    if (!HEADLINE_ONLY) {
      const s = await scenarios();
      say(`\nScenarios: ${s.join(", ")}`);
      if (s.some((x) => /FAIL/.test(x))) code = 1;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    if (e instanceof TypeError && /fetch failed/.test(e.message)) console.error(`Is the server running at ${BASE}?`);
    code = 1;
  } finally {
    if (server?.pid) server.kill("SIGTERM"); // only the server this script started, by its own handle
  }
  process.exit(code);
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
