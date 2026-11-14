import type { Product } from "@/core/catalog";
import { localNow } from "@/core/kitchen";
import { newId } from "@/core/util";
import type { Runtime } from "@/server/runtime";
import type { Json, Reply } from "@/server/show/agent";
import { orderLines } from "@/server/show/agent";
import { PARTNER_AGENT, RestAgent, credentialsFor, deliveryDay, forgedToken, mcpAgent, onsiteAgent, type Credentials, type Who } from "./agents";
import { play, playingNow, sampleNow } from "./clock";
import { SAMPLE_STEP_PLAYED } from "./marks";

/**
 * THE SAMPLE WEEK. A compact, scripted story played through the real engines with scripted inputs and no model call:
 * every entry it leaves is a genuine ledger entry the gate, the quote signer, the approval flow, the watch, the
 * selling agent and mail wrote, stamped as sample (marks.ts), at the moment the beat happens (clock.ts). Each beat
 * stands alone: one that fails is reported and the rest go on.
 *
 *   week     the wholesaler's side over the past six days: the demo kitchens' agents (Kaari on-site, Laakso over REST
 *            and MCP, the Aiven buyer), every way an order is decided and ends, refusals by several rules, a mistake
 *            check answered both ways, rule changes (an allergen added, an agent suspended and released)
 *   today    the agents' scorecard for today: one performing, one escalating (its limit too tight), one failing (an
 *            outside agent that keeps hitting one rule), and orders waiting for a person right now, of different ages
 *   kitchens the three shared test kitchens, as now: their store's orders in different states, the watch (a product
 *            that cannot come and its substitutes, a held renewal, an auto-renewal), the selling agent's offers,
 *            mail recorded as sample, and short recorded conversations (one in Finnish)
 */
export type Part = "week" | "today" | "kitchens";
export type BeatResult = { name: string; ok: boolean; detail: string; ms: number };
export type SeedReport = { setId: string; startedAt: string; ms: number; beats: BeatResult[]; ids: Record<string, string> };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** How long ago `daysAgo` days back at hh:mm Helsinki time was; never in the future, never before `floorMs` ago. */
export function agoAt(now: Date, daysAgo: number, hh: number, mm: number): number {
  const date = localNow(new Date(now.getTime() - daysAgo * DAY)).date;
  const at = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${helsinkiOffset(new Date(`${date}T12:00:00Z`))}`);
  return Math.max(0, now.getTime() - at);
}

function helsinkiOffset(d: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", timeZoneName: "shortOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const m = /GMT([+-])(\d+)/.exec(name);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:00` : "+02:00";
}

/** Minutes ago, but inside today (UTC), so today's scorecard counts it: squeezed after midnight UTC when it is early. */
export function todayAgo(now: Date, minutes: number, slot: number, slots: number): number {
  const sinceMidnight = now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const want = minutes * MIN;
  if (want < sinceMidnight - MIN) return want;
  return Math.max(0, Math.round(((sinceMidnight - MIN) * (slots - slot)) / (slots + 1)));
}

type Ctx = { rt: Runtime; setId: string; now: Date; cast: Cast; ids: Record<string, string>; beats: BeatResult[]; slowTurnMs: number };

async function beat(c: Ctx, name: string, agoMs: number, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now();
  try {
    const detail = await play(c.setId, agoMs, name, fn);
    c.beats.push({ name, ok: true, detail, ms: Date.now() - t0 });
  } catch (err) {
    c.beats.push({ name, ok: false, detail: (err as Error).message.slice(0, 400), ms: Date.now() - t0 });
  }
}

/** The same beat a little later (a person answering, an expiry): the moment moves, the sample set stays. */
const later = <T>(c: Ctx, agoMs: number, fn: () => Promise<T>): Promise<T> => play(c.setId, agoMs, playingNow()?.beat ?? "later", fn);

// ---------- the products, by attribute, from whichever catalogue runs ----------

export type Cast = { milk: Product; milkSmall: Product; forbiddenForLaakso?: Product; lowProteinDrink?: Product; poorRecord?: Product };

export async function castOf(rt: Runtime): Promise<Cast> {
  const cat = rt.catalog;
  const milks = (await cat.searchProducts({ category: "milk", attributes: ["lactose_free"], limit: 60 })).sort((a, b) => a.id.localeCompare(b.id));
  const box = milks.find((p) => p.packSize >= 5 && p.packSize <= 12 && p.unit === "L") ?? milks.find((p) => p.unit === "L") ?? milks[0];
  const small = milks.find((p) => p.packSize === 1 && p.unit === "L" && p.id !== box?.id) ?? box;
  if (!box) throw new Error("the catalogue has no lactose-free milk");
  const drinks = (await cat.searchProducts({ category: "plant_drink", limit: 80 })).sort((a, b) => a.id.localeCompare(b.id));
  // Laakso's mandate forbids gluten and nuts: an oat drink (gluten) is what its partner agent keeps trying.
  const forbidden = drinks.find((p) => p.allergens.some((a) => a === "gluten" || a === "nuts") && p.attributes.includes("lactose_free")) ?? drinks.find((p) => p.allergens.some((a) => a === "gluten" || a === "nuts"));
  // A school's milk must keep milk's protein (3 g / 100 ml): a plant drink well below it.
  const low = drinks.find((p) => (p.nutrition?.values.protein ?? 9) < 2 && !p.allergens.includes("nuts"));
  return { milk: box, milkSmall: small, ...(forbidden ? { forbiddenForLaakso: forbidden } : {}), ...(low ? { lowProteinDrink: low } : {}) };
}

// ---------- the intake, driven as a person would answer ----------

type Caller = { call<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<Reply<T>> };
type Driven = { requestId: string; order?: Json; refused?: { code?: string; rule?: string; message?: string }; state: string; concerns: string[] };

/**
 * Open an intake and take it to a placed order: checks answered as `mistake` says (fix: the first correction;
 * confirm: as asked), questions with their first answer, the option the kitchen's goal ranks first.
 */
async function intakeOrder(a: Caller, need: Json, by: string, mistake: "fix" | "confirm" = "confirm"): Promise<Driven> {
  let r = await a.call<{ step: Json }>("POST", "/api/v1/intake", { need, by });
  let s = r.body.step;
  if (!s) throw new Error(`intake: HTTP ${r.status} ${r.body.error?.code ?? ""} ${r.body.error?.message ?? ""}`.trim());
  const requestId = String(s.requestId);
  const concerns: string[] = [];
  for (let i = 0; i < 8 && s && s.state !== "quoted"; i++) {
    if (s.state === "needs_confirmation") {
      concerns.push(...(s.concerns as Json[]).map((x) => String(x.code)));
      r = await a.call("POST", `/api/v1/intake/${requestId}/concerns`, { by, responses: (s.concerns as Json[]).map((x) => ({ key: x.key, choice: mistake === "fix" && x.corrections?.[0] ? x.corrections[0].id : x.confirmable === false && x.corrections?.[0] ? x.corrections[0].id : "confirm" })) });
    } else if (s.state === "needs_input") {
      r = await a.call("POST", `/api/v1/intake/${requestId}/answers`, { by, answers: (s.questions as Json[]).map((q) => ({ questionId: q.id ?? q.questionId, optionId: (q.options[0].id ?? q.options[0].optionId) as string })) });
    } else if (s.state === "options_ready") {
      const pick = s.preselected?.optionId ?? (s.options as Json[]).find((o) => o.match === "full")?.optionId ?? (s.options as Json[])[0]?.optionId;
      if (!pick) return { requestId, state: "no_options", concerns };
      r = await a.call("POST", `/api/v1/intake/${requestId}/choice`, { by, optionId: pick });
    } else break;
    s = r.body.step;
    if (!s) throw new Error(`intake ${requestId}: HTTP ${r.status} ${r.body.error?.message ?? ""}`);
  }
  if (s.state !== "quoted" || !s.quote) return { requestId, state: String(s.state), concerns };
  const placed = await a.call<{ order: Json }>("POST", "/api/v1/orders", { requestId, quoteToken: s.quote.quoteToken, lines: orderLines(s.quote.quote) });
  if (!placed.body.order) return { requestId, state: "refused", concerns, refused: placed.body.error };
  return { requestId, order: placed.body.order, state: String(placed.body.order.status), concerns };
}

/** A request, a quote for named products and an order: what an outside agent that knows what it wants does. */
async function directOrder(a: Caller, text: string, neededBy: string, lines: { productId: string; quantity: number }[]): Promise<Driven & { quoteToken?: string; quoteLines?: Json[] }> {
  const req = await a.call<{ request: Json }>("POST", "/api/v1/requests", { text, neededBy, productIds: lines.map((l) => l.productId) });
  if (!req.body.request) return { requestId: "", state: "refused", concerns: [], refused: req.body.error };
  const requestId = String(req.body.request.requestId);
  const q = await a.call<{ quote: Json; quoteToken: string }>("POST", "/api/v1/quotes", { requestId, lines });
  if (!q.body.quoteToken) return { requestId, state: "refused", concerns: [], refused: q.body.error };
  const placed = await a.call<{ order: Json }>("POST", "/api/v1/orders", { requestId, quoteToken: q.body.quoteToken, lines: orderLines(q.body.quote) });
  if (!placed.body.order) return { requestId, state: "refused", concerns: [], refused: placed.body.error, quoteToken: q.body.quoteToken, quoteLines: orderLines(q.body.quote) };
  return { requestId, order: placed.body.order, state: String(placed.body.order.status), concerns: [], quoteToken: q.body.quoteToken, quoteLines: orderLines(q.body.quote) };
}

const milkNeed = (amount: number, deliverBy: string, extra: Json = {}): Json => ({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount, unit: "L" }, deliverBy, requiredClaims: ["lactose_free"], optimise: "price", ...extra });

/** The named person's answer on their phone, through the approvals route with the link the gate sent them. */
async function signOff(c: Ctx, orderId: string, decision: "approve" | "decline", note: string): Promise<Json> {
  const msg = c.rt.outbox.messages().find((m) => m.orderId === orderId);
  if (!msg) throw new Error(`no sign-off was asked for ${orderId}`);
  const token = new URL(msg.link, "https://x.example").searchParams.get("token") ?? "";
  const a = new RestAgent({ mandateToken: "", agentId: "" });
  const r = await a.call("POST", `/api/v1/approvals/${msg.approvalId}`, { decision, token, note });
  if (!r.body.order) throw new Error(`sign-off ${orderId}: HTTP ${r.status} ${r.body.error?.message ?? ""}`);
  return r.body.order;
}

const describe = (d: Driven) => (d.order ? `${d.order.orderId} ${d.order.status} €${(Number(d.order.totalCents) / 100).toFixed(2)}${d.order.status === "rejected" ? ` (${((d.order.decision?.rules ?? []) as Json[]).filter((r) => r.outcome === "fail").map((r) => r.rule).join(", ")})` : ""}` : `${d.state}${d.refused ? ` (${d.refused.rule ?? d.refused.code}: ${String(d.refused.message ?? "").slice(0, 120)})` : ""}`);

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new Error(what);
  return v;
}

async function agentAt(c: Ctx, who: Who): Promise<Credentials> {
  return credentialsFor(c.rt, who, sampleNow());
}

// ---------- the week ----------

async function week(c: Ctx): Promise<void> {
  const { now, cast, ids } = c;
  const kaari = async () => onsiteAgent(await agentAt(c, "kaari"), "kaari", `sample-${c.setId}`);
  const laaksoRest = async () => new RestAgent(await agentAt(c, "laakso"));

  // The partner agent's trial week: a weekly budget of its own (€600), the first thing Laakso's organisation buys this week.
  const trial = () => ({ weeklyBudgetCents: 60_000, mandateId: `mnd_laakso_partner_trial_${localNow(sampleNow()).date.replaceAll("-", "")}` });
  await beat(c, "the partner agent: a big order within its limit, placed alone", agoAt(now, 6, 7, 45), async () => describe(await directOrder(new RestAgent(await credentialsFor(c.rt, "partner", sampleNow(), trial())), `38 boxes of ${cast.milk.name}`, deliveryDay(sampleNow(), 2), [{ productId: cast.milk.id, quantity: 38 }])));
  await beat(c, "the partner agent: one more, over its weekly budget", agoAt(now, 6, 7, 58), async () => {
    const d = await directOrder(new RestAgent(await credentialsFor(c.rt, "partner", sampleNow(), trial())), `16 boxes of ${cast.milk.name}`, deliveryDay(sampleNow(), 3), [{ productId: cast.milk.id, quantity: 16 }]);
    if (d.order) ids.budgetRefused = d.order.orderId;
    return describe(d);
  });
  await beat(c, "laakso: standing order over REST, placed alone", agoAt(now, 6, 8, 12), async () => {
    const d = await intakeOrder(await laaksoRest(), milkNeed(160, deliveryDay(sampleNow(), 2)), "Aino Virtanen (kitchen manager)");
    if (d.order) ids.laaksoAlone = d.order.orderId;
    return describe(d);
  });

  await beat(c, "aiven buyer: an order over MCP", agoAt(now, 6, 13, 40), async () => {
    const call = await mcpAgent(await agentAt(c, "aiven"), `?agent_id=agent_laakso_aiven_01`);
    let step = (await call("submit_need", { need: milkNeed(60, deliveryDay(sampleNow(), 2)), by: "Aino Virtanen" })).step as Json;
    const requestId = String(step.requestId);
    for (let n = 0; n < 6 && step.state !== "quoted"; n++) {
      if (step.state === "needs_confirmation") step = (await call("respond_to_concerns", { requestId, by: "Aino Virtanen", responses: (step.concerns as Json[]).map((x) => ({ key: x.key, choice: "confirm" })) })).step;
      else if (step.state === "needs_input") step = (await call("answer_questions", { requestId, by: "Aino Virtanen", answers: (step.questions as Json[]).map((q) => ({ questionId: q.questionId ?? q.id, optionId: q.options[0].optionId ?? q.options[0].id })) })).step;
      else if (step.state === "options_ready") step = (await call("choose_option", { requestId, by: "Aino Virtanen", optionId: step.preselected?.optionId ?? step.options[0].optionId })).step;
      else throw new Error(`intake ended as ${step.state}`);
    }
    const placed = await call("place_order", { requestId });
    ids.aivenOrder = placed.order.orderId;
    if (placed.order.status === "pending_approval") await later(c, agoAt(now, 6, 13, 40) - 5 * MIN, () => signOff(c, placed.order.orderId, "approve", "Fine, the usual."));
    return `${placed.order.orderId} ${placed.order.status}`;
  });

  await beat(c, "kaari: over its limit, sent to the head chef, approved", agoAt(now, 5, 10, 25), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(120, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    const o = need(d.order, `not placed: ${describe(d)}`);
    ids.approved = o.orderId;
    if (o.status !== "pending_approval") return `${describe(d)} (no sign-off needed)`;
    const after = await later(c, agoAt(now, 5, 10, 25) - 7 * MIN, () => signOff(c, o.orderId, "approve", "OK, the conference needs it."));
    return `${o.orderId} approved after 7 min: ${after.status}`;
  });

  await beat(c, "laakso: an order over MCP, placed alone", agoAt(now, 5, 11, 5), async () => {
    const call = await mcpAgent(await agentAt(c, "laakso"));
    const date = deliveryDay(sampleNow(), 2);
    const requestId = (await call("open_request", { text: `40 packs of ${cast.milkSmall.name}`, neededBy: date, productIds: [cast.milkSmall.id] })).request.requestId as string;
    const q = await call("request_quote", { requestId, lines: [{ productId: cast.milkSmall.id, quantity: 40 }] });
    const o = await call("place_order", { requestId, quoteToken: q.quoteToken, lines: orderLines(q.quote) });
    ids.mcpOrder = o.order.orderId;
    return `${o.order.orderId} ${o.order.status}`;
  });

  await beat(c, "kaari: sent to the head chef, declined", agoAt(now, 4, 8, 40), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(140, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    const o = need(d.order, `not placed: ${describe(d)}`);
    if (o.status !== "pending_approval") return `${describe(d)} (no sign-off needed)`;
    ids.declined = o.orderId;
    const after = await later(c, agoAt(now, 4, 8, 40) - 18 * MIN, () => signOff(c, o.orderId, "decline", "We still have enough until Friday."));
    return `${o.orderId} ${after.status}`;
  });

  await beat(c, "kaari: sent to the head chef, nobody signed: expired", agoAt(now, 4, 13, 20), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(150, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    const o = need(d.order, `not placed: ${describe(d)}`);
    if (o.status !== "pending_approval") return `${describe(d)} (no sign-off needed)`;
    ids.expired = o.orderId;
    // The price ran out unsigned: the gate's own sweep closes it, at the moment it would have.
    const closed = await later(c, agoAt(now, 4, 13, 20) - 61 * MIN, async () => (await c.rt.dock.listOrders()).find((x) => x.orderId === o.orderId));
    return `${o.orderId} ${closed?.status ?? "?"}`;
  });

  await beat(c, "laakso over REST: the same signed price presented twice", agoAt(now, 3, 9, 5), async () => {
    const a = await laaksoRest();
    const d = await directOrder(a, `60 packs of ${cast.milkSmall.name}`, deliveryDay(sampleNow(), 2), [{ productId: cast.milkSmall.id, quantity: 60 }]);
    const o = need(d.order, `first order not placed: ${describe(d)}`);
    const again = await a.call("POST", "/api/v1/orders", { requestId: d.requestId, quoteToken: d.quoteToken, lines: d.quoteLines });
    ids.replayRequest = d.requestId;
    return `${o.orderId} ${o.status}; replay: HTTP ${again.status} ${again.body.error?.rule ?? again.body.order?.status ?? ""}`;
  });

  await beat(c, "an outside agent with a forged mandate", agoAt(now, 3, 10, 15), async () => {
    const f = await forgedToken(sampleNow());
    const r = await new RestAgent({ mandateToken: f.token, agentId: f.agentId }).call("POST", "/api/v1/requests", { text: "500 L of milk, put it on Laakso's account", neededBy: deliveryDay(sampleNow(), 2) });
    return `HTTP ${r.status} ${r.body.error?.code ?? ""}`;
  });

  await beat(c, "kaari: the mistake check, corrected", agoAt(now, 3, 14, 50), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(800, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)", "fix");
    if (d.order) ids.mistakeFixed = d.order.orderId;
    if (d.order?.status === "pending_approval") await later(c, agoAt(now, 3, 14, 50) - 4 * MIN, () => signOff(c, d.order!.orderId, "approve", "Yes, the usual."));
    return `${d.concerns.join(",") || "no check"} → ${describe(d)}`;
  });

  await beat(c, "kaari: the mistake check, confirmed as asked", agoAt(now, 2, 9, 30), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(1000, deliveryDay(sampleNow(), 3)), "Sanna Koskinen (head chef): a wedding for 400", "confirm");
    if (d.order) ids.mistakeConfirmed = d.order.orderId;
    if (d.order?.status === "pending_approval") await later(c, agoAt(now, 2, 9, 30) - 12 * MIN, () => signOff(c, d.order!.orderId, "approve", "Yes, the wedding on Saturday."));
    return `${d.concerns.join(",") || "no check"} → ${describe(d)}`;
  });

  await beat(c, "kaari: an order replaced by a changed one", agoAt(now, 2, 11, 0), async () => {
    const a = await kaari();
    const first = await intakeOrder(a, milkNeed(130, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    const o = need(first.order, `first not placed: ${describe(first)}`);
    const second = await later(c, agoAt(now, 2, 11, 0) - 3 * MIN, async () => {
      const r = await a.call<{ step: Json }>("POST", "/api/v1/intake", { need: milkNeed(110, deliveryDay(sampleNow(), 2)), by: "Sanna Koskinen (head chef)" });
      let s = r.body.step;
      for (let i = 0; i < 6 && s && s.state !== "quoted"; i++) {
        if (s.state === "needs_confirmation") s = (await a.call<{ step: Json }>("POST", `/api/v1/intake/${s.requestId}/concerns`, { by: "Sanna Koskinen", responses: (s.concerns as Json[]).map((x) => ({ key: x.key, choice: "confirm" })) })).body.step;
        else if (s.state === "options_ready") s = (await a.call<{ step: Json }>("POST", `/api/v1/intake/${s.requestId}/choice`, { by: "Sanna Koskinen", optionId: s.preselected?.optionId ?? s.options[0].optionId })).body.step;
        else if (s.state === "needs_input") s = (await a.call<{ step: Json }>("POST", `/api/v1/intake/${s.requestId}/answers`, { by: "Sanna Koskinen", answers: (s.questions as Json[]).map((q) => ({ questionId: q.id, optionId: q.options[0].id })) })).body.step;
        else break;
      }
      if (s?.state !== "quoted") throw new Error(`the change ended as ${s?.state}`);
      return a.call<{ order: Json; replaced?: Json }>("POST", "/api/v1/orders", { requestId: s.requestId, quoteToken: s.quote.quoteToken, lines: orderLines(s.quote.quote), replaces: o.orderId });
    });
    ids.replaced = o.orderId;
    if (second.body.order) ids.replacement = second.body.order.orderId;
    return `${o.orderId} replaced by ${second.body.order?.orderId ?? `nothing (${second.body.error?.message})`}: ${JSON.stringify(second.body.replaced ?? {})}`;
  });

  await beat(c, "kaari: an order taken back before anyone signed", agoAt(now, 2, 15, 45), async () => {
    const a = await kaari();
    const d = await intakeOrder(a, milkNeed(125, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    const o = need(d.order, `not placed: ${describe(d)}`);
    const w = await later(c, agoAt(now, 2, 15, 45) - 9 * MIN, () => a.withdraw(o.orderId, "The party of 40 was cancelled.", "Sanna Koskinen (head chef)"));
    ids.takenBack = o.orderId;
    return `${o.orderId} ${w.body.order?.status ?? w.body.error?.message}`;
  });

  await beat(c, "rules: an allergen added to Hotel Lumo's mandate", agoAt(now, 1, 9, 10), async () => {
    const { reissueKitchenMandate } = await import("@/server/mandate-reissue");
    const k = need(await c.rt.accounts.kitchenOf("hotel-lumo"), "no Hotel Lumo");
    const r = await reissueKitchenMandate(c.rt, { slug: "hotel-lumo", kind: "account", orgId: k.kitchen!.orgId, name: k.account.restaurant }, { forbiddenAllergens: ["sesame"] }, "Kitchen manager (sample)");
    return `${r.replaced} → ${r.mandateId}`;
  });

  await beat(c, "rules: the partner agent suspended and released", agoAt(now, 1, 12, 0), async () => {
    const { suspensions } = await import("@/server/ops/suspensions");
    const reg = suspensions(c.rt.dock);
    const s = reg.suspend({ scope: "agent", target: PARTNER_AGENT.agentId, label: PARTNER_AGENT.label, reason: "Sample: it keeps sending an oat drink with gluten; paused while Laakso checks its settings.", by: "Operations (sample)", orgId: "org_laakso_catering" });
    await later(c, agoAt(now, 1, 12, 0) - 40 * MIN, async () => reg.resume(s.suspensionId, { by: "Operations (sample)", note: "Laakso says the partner fixed its product list." }));
    return `${s.suspensionId} suspended and resumed after 40 min`;
  });

  await beat(c, "the partner agent: an oat drink against the allergen rule (yesterday)", agoAt(now, 1, 15, 20), () => partnerTries(c));
}

async function partnerTries(c: Ctx): Promise<string> {
  const p = need(c.cast.forbiddenForLaakso, "no product in Laakso's groups with a forbidden allergen");
  const a = new RestAgent(await credentialsFor(c.rt, "partner", sampleNow()));
  const d = await directOrder(a, `24 packs of ${p.name}`, deliveryDay(sampleNow(), 2), [{ productId: p.id, quantity: 24 }]);
  if (d.order) c.ids.partnerRefused = d.order.orderId;
  return describe(d);
}

// ---------- today: the scorecard and what waits now ----------

async function today(c: Ctx): Promise<void> {
  const { now, ids } = c;
  const kaari = async () => onsiteAgent(await agentAt(c, "kaari"), "kaari", `sample-${c.setId}`);
  const slots = 9;
  await beat(c, "laakso: today's first order over REST, alone", todayAgo(now, 300, 0, slots), async () => describe(await intakeOrder(new RestAgent(await agentAt(c, "laakso")), milkNeed(180, deliveryDay(sampleNow(), 1)), "Aino Virtanen (kitchen manager)")));
  await beat(c, "kaari: over its limit again, approved", todayAgo(now, 260, 1, slots), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(110, deliveryDay(sampleNow(), 1)), "Sanna Koskinen (head chef)");
    if (d.order?.status === "pending_approval") await later(c, todayAgo(now, 260, 1, slots) - 6 * MIN, () => signOff(c, d.order!.orderId, "approve", "Fine."));
    return describe(d);
  });
  await beat(c, "the partner agent: the oat drink again", todayAgo(now, 220, 2, slots), () => partnerTries(c));
  await beat(c, "kaari: over its limit a third time, approved", todayAgo(now, 180, 3, slots), async () => {
    const d = await intakeOrder(await kaari(), milkNeed(115, deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
    if (d.order?.status === "pending_approval") await later(c, todayAgo(now, 180, 3, slots) - 9 * MIN, () => signOff(c, d.order!.orderId, "approve", "Yes. Our limit is too low for weekends."));
    return describe(d);
  });
  await beat(c, "laakso: a second order over REST, alone", todayAgo(now, 130, 4, slots), async () => describe(await intakeOrder(new RestAgent(await agentAt(c, "laakso")), milkNeed(150, deliveryDay(sampleNow(), 2)), "Aino Virtanen (kitchen manager)")));
  await beat(c, "the partner agent: and again", todayAgo(now, 90, 5, slots), () => partnerTries(c));
  await beat(c, "the partner agent: a fourth time", todayAgo(now, 45, 6, slots), () => partnerTries(c));
  await waiting(c);
  void ids;
}

/** Two or three orders waiting for the head chef right now, of different ages (each holds its price for 30 minutes). */
export async function waiting(c: Ctx, ages = [22, 11, 3]): Promise<void> {
  for (const [i, m] of ages.entries()) {
    await beat(c, `kaari: waiting for the head chef (${m} min)`, m * MIN, async () => {
      const a = onsiteAgent(await agentAt(c, "kaari"), "kaari", `sample-${c.setId}`);
      const d = await intakeOrder(a, milkNeed([120, 135, 160][i % 3], deliveryDay(sampleNow(), 2)), "Sanna Koskinen (head chef)");
      if (d.order?.status === "pending_approval") c.ids[`waiting${i}`] = d.order.orderId;
      return describe(d);
    });
  }
}

// ---------- the seed ----------

export type PlayOptions = { setId?: string; parts?: Part[]; now?: Date; /** How long the one slow sample turn is held (0: none). Default 21 s. */ slowTurnMs?: number; /** Top-ups of the current set (start.ts): new waiting orders, the slow turn again. */ fresh?: { waiting?: boolean; slow?: boolean } };

export async function playStory(rt: Runtime, opts: PlayOptions = {}): Promise<SeedReport> {
  const t0 = Date.now();
  const setId = opts.setId ?? newId("smp");
  const now = opts.now ?? new Date();
  const parts = opts.parts ?? (opts.fresh ? [] : ["week", "today", "kitchens"]);
  const c: Ctx = { rt, setId, now, cast: await castOf(rt), ids: {}, beats: [], slowTurnMs: opts.slowTurnMs ?? 21_000 };
  // The first entry of the set, at the start of its week: what it is, in words (not again for a top-up of the same set).
  if (!opts.setId || parts.includes("week")) await play(setId, agoAt(now, 6, 7, 30), "start", async () => {
    rt.dock.ledger.append({ type: "control", actor: "dock", summary: `SAMPLE ACTIVITY: a scripted week played through the real gate with scripted inputs and no model calls, so every page has something to show. Every entry of it carries the sample flag (set ${setId}); nothing was ordered from anyone, no mail left, and the partner's live API was not called for it.`, data: { step: "sample_started", parts } });
  });
  if (parts.includes("week")) await week(c);
  if (parts.includes("today")) await today(c);
  if (parts.includes("kitchens")) {
    const { kitchens } = await import("./kitchens");
    await kitchens(c);
  }
  if (opts.fresh?.waiting) {
    await waiting(c);
    await (await import("./kitchens")).kitchenWaiting(c);
  }
  if (opts.fresh?.slow) await (await import("./kitchens")).slowTurn(c);
  const ok = c.beats.filter((b) => b.ok).length;
  await play(setId, 0, "end", async () => {
    rt.dock.ledger.append({ type: "control", actor: "dock", summary: `Sample activity played: ${ok} of ${c.beats.length} scripted beats, in ${((Date.now() - t0) / 1000).toFixed(1)} s.`, data: { step: SAMPLE_STEP_PLAYED, beats: c.beats.map((b) => ({ name: b.name, ok: b.ok })), ids: c.ids } });
  });
  return { setId, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, beats: c.beats, ids: c.ids };
}

export type { Ctx };
export { beat, intakeOrder, directOrder, signOff, later, describe, milkNeed, need, agentAt, MIN, HOUR, DAY };
