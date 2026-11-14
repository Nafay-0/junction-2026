import type { AgentSession } from "@/core/orders";
import { addDaysIso, localNow } from "@/core/kitchen";
import { newId } from "@/core/util";
import type { Runtime } from "@/server/runtime";
import type { Json } from "@/server/show/agent";
import { RestAgent, credentialsFor, deliveryDay, mcpAgent, onsiteAgent, type Who } from "./agents";
import { play, playingNow, sampleNow } from "./clock";
import { MIN, beat, describe, directOrder, intakeOrder, later, milkNeed, need, signOff, type Ctx } from "./story";

/**
 * The kitchens' side of the sample. Two rules, because people sign into these kitchens (judges, testers):
 *
 *   The shared test kitchens (and the demo kitchens) get only CLOSED records: orders placed or refused, receipts in
 *   the mail log, and their conversations as ledger records. The sample never opens a live conversation in them,
 *   never leaves a question, a choice, a draft or an order waiting there, and never stages anything there: a person
 *   who signs in finds a kitchen whose next words start something new. Anything still waiting at the end of a play
 *   is taken back (closeOpen).
 *
 *   Everything that stays open (orders waiting for a person, a staged stock-out, a held renewal, open offers, a
 *   backup) lives in the sample's own kitchens (agents.ts openSampleKitchens), which no person can sign into.
 */
const TEST: Who[] = ["hotel-lumo", "koulu-metsola", "kahvila-sointu"];
const SAMPLE_ADDRESS = (slug: string) => `sample.${slug}@example.com`;

async function sessionOf(rt: Runtime, who: Who): Promise<AgentSession> {
  const c = await credentialsFor(rt, who, sampleNow());
  return rt.dock.authenticate(c.mandateToken, c.agentId, { via: "onsite", transport: "direct", path: "/sample", method: "POST" } as never);
}

async function orgOf(rt: Runtime, slug: string): Promise<{ orgId: string; name: string }> {
  if (slug === "kaari") return { orgId: "org_ravintola_kaari", name: "Ravintola Kaari" };
  if (slug === "laakso") return { orgId: "org_laakso_catering", name: "Laakso Catering Oy" };
  if (slug.startsWith("sbx_")) {
    const m = need(await rt.sandboxes.mandateOf(slug), `the sample kitchen ${slug} has closed`);
    return { orgId: m.issuer.orgId, name: m.issuer.name };
  }
  const k = need(await rt.accounts.kitchenOf(slug), `no account ${slug}`);
  return { orgId: k.kitchen!.orgId, name: k.account.restaurant };
}

// ---------- mail: recorded as sample, never sent ----------

/**
 * Mail for sample beats is recorded with its preview and not sent (server/notify deliver() skips it while a sample beat
 * plays, with that reason), and it never counts against the caps. Nothing is swapped: any other mail goes as usual.
 */
async function withSampleMail<T>(rt: Runtime, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await (await import("@/server/notify/service")).settled(rt).catch(() => undefined);
  }
}

async function giveAddresses(c: Ctx, slugs: string[]): Promise<string> {
  const mail = await import("@/server/notify/service");
  const out: string[] = [];
  for (const slug of slugs) {
    const k = await orgOf(c.rt, slug);
    const { confirmation } = await mail.setAddress(c.rt, { orgId: k.orgId, slug, name: k.name }, SAMPLE_ADDRESS(slug.replace(/_/g, "-")), { by: "Purchasing manager (sample)", via: "the sample activity", lang: slug === c.sampleKitchens[0] ? "fi" : "en", now: sampleNow() });
    const link = (confirmation?.model as { links?: { confirm?: string } } | undefined)?.links?.confirm;
    const t = link ? new URL(link, "https://x.example").searchParams.get("t") : null;
    const r = await mail.confirmAddress(c.rt, t, sampleNow());
    out.push(`${slug} ${r.ok ? "confirmed" : r.problem}`);
  }
  return out.join(", ");
}

/** The sample addresses are taken away at the end: a real order of a test kitchen later never mails example.com. */
async function removeAddresses(c: Ctx, slugs: string[]): Promise<string> {
  const mail = await import("@/server/notify/service");
  for (const slug of slugs) await mail.removeAddress(c.rt, (await orgOf(c.rt, slug)).orgId, { by: "the sample activity", via: "the end of the sample" }, sampleNow());
  return `removed for ${slugs.join(", ")}`;
}

// ---------- conversations, as records ----------

type Turn = { words: string; line: string; need?: Json; door?: "typed" | "voice" };

/**
 * A kitchen's conversation with its agent, written as records and never played through the live conversation: each
 * turn is the buyer's words, the order the agent placed for them through the gate (the kitchen's on-site agent, the
 * same REST routes and checks), the agent's line and the turn's end, in the ledger entries the Conversations page
 * reads, tagged with a thread of their own. The kitchen's live conversation is not touched: no card, no question, no
 * "last request" is left in it for a person's next words to be read against. No model is called.
 */
async function recordConversation(c: Ctx, slug: Who, turns: Turn[], opts: { slowMs?: number } = {}): Promise<string> {
  const creds = await credentialsFor(c.rt, slug, sampleNow());
  const threadId = newId("thr");
  const out: string[] = [];
  for (const t of turns) {
    const turnId = newId("trn");
    const door = t.door ?? "typed";
    const tag = { thread: { threadId, turnId, door } };
    const actor = `agent:${creds.agentId}`;
    const t0 = Date.now();
    c.rt.dock.ledger.append({ type: "agent", actor, summary: `The buyer said (${door}): "${t.words}"`, data: { event: "turn", via: door === "voice" ? "speech" : "typed", words: t.words, ...tag } });
    let requests: string[] = [];
    let orders: string[] = [];
    if (t.need) {
      const d = await intakeOrder(onsiteAgent(creds, slug, `sample-${c.setId}`, door), t.need, `${creds.name} (in the conversation)`);
      requests = [d.requestId];
      orders = d.order ? [String(d.order.orderId)] : [];
      c.rt.dock.ledger.append({ type: "agent", actor, requestId: d.requestId, summary: `The agent called order with the buyer's words: ${describe(d)}.`, data: { event: "tool_call", tool: "order", ...tag } });
      out.push(describe(d));
    } else out.push("answered");
    const done = async () => {
      c.rt.dock.ledger.append({ type: "agent", actor, summary: `The agent said: "${t.line}"`, data: { event: "said", line: t.line, ...tag } });
      const ms = opts.slowMs ?? Date.now() - t0;
      c.rt.dock.ledger.append({ type: "agent", actor, summary: `Agent turn finished (done) in ${ms} ms${opts.slowMs ? " (sample: a slow turn, so the Platform page shows a breaching alert)" : ""}.`, data: { event: "turn_done", status: "done", ms, marks: { done: ms }, requests, orders, ...tag } });
    };
    if (opts.slowMs) await later(c, Math.max(0, -(playingNow()?.offsetMs ?? 0) - opts.slowMs), done);
    else await done();
  }
  return out.join("; ");
}

const PLAN = (day: (n: number, w?: number[]) => string, k: Who[]): [Who, Turn[][]][] => {
  const D = [1, 2, 3, 4, 5, 6];
  const [s1, s2, , s4] = k;
  return [
    [s4, [
      [{ words: "What do we usually order for Saturday breakfast?", line: "Lactose-free milk in 10 L boxes, about 400 L every Monday and Thursday. Your rule: always lactose-free." }],
      [{ words: `6 litres of lactose-free whipping cream for ${day(2, D)}`, need: { item: { text: "lactose-free whipping cream", category: "cream" }, quantity: { amount: 6, unit: "L" }, deliverBy: day(2, D), requiredClaims: ["lactose_free"], optimise: "price" }, line: "Ordered, within what I may spend alone." }],
      [{ door: "voice", words: `Ten kilos of lactose-free natural yoghurt for ${day(3, D)}`, need: { item: { text: "lactose-free natural yoghurt", category: "yoghurt" }, quantity: { amount: 10, unit: "kg" }, deliverBy: day(3, D), requiredClaims: ["lactose_free"], optimise: "price" }, line: "Done: ten kilos, lactose-free, as always." }],
    ]],
    [s1, [
      [{ words: `Tarvitsemme 60 litraa laktoositonta maitoa ${day(2, D)}`, need: { item: { text: "laktoositon maito", category: "milk" }, quantity: { amount: 60, unit: "L" }, deliverBy: day(2, D), requiredClaims: ["lactose_free"], optimise: "price" }, line: "Tilattu: 60 litraa laktoositonta maitoa, tavallisen rajan sisällä." }],
      [{ words: "Mitä tilasimme viime maanantaina?", line: "Noin 400 litraa laktoositonta kevytmaitoa 10 litran laatikoissa, kuten joka maanantai." }],
      [{ words: "Is anything gluten-free we could use instead of oat drink?", line: "Your rules already keep everything gluten-free: every product I suggest is checked against them before it reaches you." }],
    ]],
    [s2, [
      [{ words: "How much of this week's budget is left?", line: "Most of it: the week's orders so far are well inside the budget." }],
      [{ words: `60 litres of lactose-free milk in 1 litre packs for ${day(1, D)}`, need: { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 60, unit: "L" }, deliverBy: day(1, D), requiredClaims: ["lactose_free"], optimise: "price" }, line: "Ordered: sixty one-litre packs." }],
      [{ words: "Thanks, that's all for today.", line: "Have a good day. I will tell you if anything for tomorrow cannot come." }],
    ]],
  ];
};

/** Two slow turns (21 s each, written as records), so the Platform page shows a breaching alert for 15 minutes. */
export async function slowTurns(c: Ctx): Promise<void> {
  if (!c.slowTurnMs) return;
  for (const slug of c.sampleKitchens.slice(0, 2) as Who[]) {
    await beat(c, `conversations: a slow turn in ${slug} (alert)`, 0, () => recordConversation(c, slug, [{ words: "Is the Friday delivery still on time?", line: "Yes: the cut-off for Friday is Thursday at 11:00, and nothing is late." }], { slowMs: c.slowTurnMs }));
  }
}

// ---------- the kitchens ----------

export async function kitchens(c: Ctx): Promise<void> {
  const { rt, cast, ids } = c;
  // In a test kitchen only what changes nothing for the next person: a refusal (no order, no spend, no memory).
  await beat(c, "metsola school: an oat drink as the pupils' milk (nutrition rule)", 0, async () => {
    const p = need(cast.lowProteinDrink, "no plant drink below milk's protein in this catalogue");
    const d = await directOrder(new RestAgent(await credentialsFor(rt, "koulu-metsola", sampleNow())), `20 packs of ${p.name} for lunch`, deliveryDay(sampleNow(), 1), [{ productId: p.id, quantity: 20 }]);
    if (d.order) ids.nutritionRefused = d.order.orderId;
    return describe(d);
  });
  // Conversations and their receipts in the sample's own kitchens.
  const sk = c.sampleKitchens as Who[];
  if (sk.length < 4) return;
  await withSampleMail(rt, async () => {
    await beat(c, "mail: the sample kitchens give an address (sample, nothing is sent)", 0, () => giveAddresses(c, sk));
    const day = (n: number, w = [1, 2, 3, 4, 5]) => deliveryDay(new Date(), n, w);
    for (const [slug, convs] of PLAN(day, sk)) {
      await beat(c, `conversations: ${slug}`, 0, async () => {
        const out: string[] = [];
        for (const turns of convs) out.push(await recordConversation(c, slug, turns));
        return out.join(" | ");
      });
    }
    await slowTurns(c);
    await beat(c, "mail: the sample addresses removed", 0, () => removeAddresses(c, sk));
  });
}

/** The sample's own kitchens: what stays open (no person signs into them). */
export async function sampleKitchenBeats(c: Ctx): Promise<void> {
  const [s1, s2, s3] = c.sampleKitchens as Who[];
  const MIN_ = MIN;
  if (s1) await beat(c, "watch: the usual milk cannot come (staged): a substitute ordered", 66 * MIN_, () => watchRenewal(c, s1, true));
  if (s2) await beat(c, "watch: a recurring order renewed by itself", 64 * MIN_, () => watchRenewal(c, s2, false));
  if (s3) await beat(c, "watch: a recurring order that crept up: renewal held", 62 * MIN_, () => heldRenewal(c, s3));
  const s4 = (c.sampleKitchens[3] ?? s3) as Who;
  if (s4) await beat(c, "watch: a product with a poor delivery record, its backup used", 58 * MIN_, () => backupUsed(c, s4, 52 * MIN_));
  await beat(c, "selling agent: a campaign and a run over the sample kitchens", 50 * MIN_, () => sellingAgent(c));
  await beat(c, "selling agent: the kitchens answer (accept, decline, mute)", 44 * MIN_, () => answerOffers(c));
}

// ---------- the watch ----------

async function watchRenewal(c: Ctx, slug: Who, stockOut: boolean): Promise<string> {
  const { rt } = c;
  const w = await import("@/server/watch/service");
  const { orgId } = await orgOf(rt, slug);
  const session = await sessionOf(rt, slug);
  const p = (await w.standingFor(rt, orgId, sampleNow())).find((x) => !x.drifted && x.next);
  if (!p) throw new Error(`${slug}: no recurring order without drift`);
  if (stockOut) await w.stageStockOut(rt, { kitchen: slug, productId: p.product.productId, by: "Operations (sample)", now: sampleNow() });
  await w.setAutoRenew(rt, session, { family: p.family, on: true, by: "Kitchen manager (sample)", via: "the sample activity", renewNow: false, now: sampleNow() });
  const [r] = await w.runWatch(rt, { kitchens: [slug], fresh: true, renew: "now", now: sampleNow() });
  const done = r.renewals.find((x) => x.family === p.family);
  const f = r.findings.find((x) => x.product.productId === p.product.productId);
  let switched = "";
  if (stockOut && f && f.state === "open" && f.substitutes[0]) {
    // The kitchen's answer to the finding: the first substitute (what a person taps in the store).
    const a = await later(c, Math.max(0, -(playingNow()?.offsetMs ?? 0) - 4 * MIN), () => w.answerFinding(rt, session, f.findingId, { choice: "switch", productId: f.substitutes[0].productId }, { by: "Purchasing manager (sample)", via: "the sample activity", now: sampleNow() } as never)).catch((err: Error) => ({ order: undefined, refused: { rule: err.message.slice(0, 80) } }));
    switched = `; switched to ${f.substitutes[0].productId}: ${a.order?.orderId ?? ""} ${a.order?.status ?? a.refused?.rule ?? ""}`;
  }
  return `${p.family}${switched}: renewal ${done?.state ?? "none"} ${done?.outcome?.orderId ?? ""}${f ? `; finding ${f.findingId} with ${f.substitutes.length} substitutes` : ""}${r.note ? ` (${r.note})` : ""} ${JSON.stringify(r.renewals.map((x) => [x.family, x.state, x.decision?.reason]))}`.slice(0, 500);
}

async function heldRenewal(c: Ctx, slug: Who): Promise<string> {
  const { rt } = c;
  const w = await import("@/server/watch/service");
  const { orgId } = await orgOf(rt, slug);
  const session = await sessionOf(rt, slug);
  let p = (await w.standingFor(rt, orgId, sampleNow())).find((x) => x.drifted && x.next);
  if (!p) {
    // A sample kitchen's past is steady: stage the creep (marked staged, in this kitchen only).
    const first = (await w.standingFor(rt, orgId, sampleNow())).find((x) => x.next);
    if (!first) throw new Error(`${slug}: no recurring order`);
    await w.stageDrift(rt, { kitchen: slug, family: first.family, by: "Operations (sample)", now: sampleNow() });
    p = (await w.standingFor(rt, orgId, sampleNow())).find((x) => x.family === first.family);
  }
  if (!p) throw new Error(`${slug}: no recurring order that drifted`);
  await w.setAutoRenew(rt, session, { family: p.family, on: true, by: "Kitchen manager (sample)", via: "the sample activity", renewNow: false, now: sampleNow() });
  const [r] = await w.runWatch(rt, { kitchens: [slug], fresh: true, renew: "now", now: sampleNow() });
  const done = r.renewals.find((x) => x.family === p.family);
  return `${p.family}: renewal ${done?.state ?? "none"}: ${done?.decision.reason ?? ""}${r.note ? ` (${r.note})` : ""} ${JSON.stringify(r.renewals.map((x) => [x.family, x.state]))}`.slice(0, 400);
}

/** A kitchen orders a product whose delivery record is poor, lines up the backup it is offered; the product cannot come: the watch orders the backup. */
async function backupUsed(c: Ctx, sampleSlug: Who, laterMs: number): Promise<string> {
  const { rt } = c;
  const { warnLevel } = await import("@/server/reliability/service");
  // A product with a poor delivery record the sample's stage kitchen may buy (dairy, nothing with gluten or nuts).
  const found = (await Promise.all(["milk", "plant_drink", "cream", "yoghurt"].map((category) => rt.catalog.searchProducts({ category, limit: 100 }).catch(() => [])))).flat();
  const poor = found.filter((p) => p.deliveryReliability > 0 && p.deliveryReliability < warnLevel() && !p.allergens.some((a) => a === "nuts" || a === "gluten")).sort((a, b) => a.id.localeCompare(b.id));
  const slug = sampleSlug;
  if (!poor.length) return "skipped: no product with a poor delivery record in these kitchens' groups";
  const session = await sessionOf(rt, slug);
  const { backupMomentForThread, answerBackup } = await import("@/server/reliability/thread");
  const w = await import("@/server/watch/service");
  // The first such product that can come in time (a product that cannot come by the day is refused, not backed up).
  let first: Awaited<ReturnType<typeof rt.dock.placeOrder>> | undefined;
  let productId = "";
  for (const p of poor.slice(0, 4)) {
    const req = await rt.dock.openRequest(session, { text: `4 packs of ${p.name}`, neededBy: addDaysIso(localNow(sampleNow()).date, 3), productIds: [p.id] });
    const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: p.id, quantity: 4 }] }).catch(() => undefined);
    if (!q) continue;
    first = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    productId = p.id;
    if (first.status !== "rejected") break;
  }
  if (!first) return "skipped: no poor-record product could be quoted";
  if (first.status === "pending_approval") await signOff(c, first.orderId, "approve", "Fine.").catch(() => undefined);
  const m = await backupMomentForThread(rt, session, { orderId: first.orderId }, "en");
  if (!m) return `${first.orderId} ${first.status}: no backup offered`;
  await answerBackup(rt, session, m.id, "you_choose", { by: "Purchasing manager (sample)", via: "the sample activity", lang: "en" });
  await later(c, laterMs, async () => {
    await w.stageStockOut(rt, { kitchen: slug, productId, by: "Operations (sample)", now: sampleNow() });
    await w.runWatch(rt, { kitchens: [slug], fresh: true, now: sampleNow() });
  });
  return `${slug} ${productId}: ${first.orderId} ${first.status}${first.status === "rejected" ? ` (${first.decision.rules.filter((r) => r.outcome === "fail").map((r) => `${r.rule}: ${r.reason ?? ""}`).join("; ")})` : ""}; backup lined up and used`;
}

// ---------- the selling agent ----------

async function sellingAgent(c: Ctx): Promise<string> {
  const { rt, cast } = c;
  const offers = await import("@/server/offers/service");
  const product = rt.catalogSource.kind === "valio" ? cast.milkSmall.id : "VA-1201";
  const camp = await offers.startCampaign(rt, { productId: product, by: "Category manager (sample)", listAsNew: true, kitchens: c.sampleKitchens, now: sampleNow() });
  const run = await offers.runSellingAgent(rt, { kitchens: c.sampleKitchens, now: sampleNow(), by: "the sample activity" });
  const offered = run.reduce((s, r) => s + r.offered.length, 0);
  const withheld = run.reduce((s, r) => s + r.withheld.length, 0);
  return `campaign ${camp.campaignId ?? ""}; run: ${offered} offered, ${withheld} held back by a guardrail`;
}

async function answerOffers(c: Ctx): Promise<string> {
  const { rt } = c;
  const offers = await import("@/server/offers/service");
  const out: string[] = [];
  const slugs = c.sampleKitchens as Who[];
  const open: { slug: Who; offerId: string }[] = [];
  for (const slug of slugs) for (const o of await offers.offersForOrg(rt, (await orgOf(rt, slug)).orgId, { open: true, now: sampleNow() })) open.push({ slug, offerId: o.offerId });
  const [acc, dec, mute] = [open[0], open[1], open[2]];
  if (acc) {
    const cr = await credentialsFor(rt, acc.slug, sampleNow());
    const call = await mcpAgent(cr);
    let step = (await call("accept_offer", { offerId: acc.offerId, packs: 3, by: "Sample buyer" })).step as Json;
    const requestId = String(step.requestId);
    for (let n = 0; n < 6 && step && step.state !== "quoted"; n++) {
      if (step.state === "needs_confirmation") step = (await call("respond_to_concerns", { requestId, by: "Sample buyer", responses: (step.concerns as Json[]).map((x) => ({ key: x.key, choice: "confirm" })) })).step;
      else if (step.state === "needs_input") step = (await call("answer_questions", { requestId, by: "Sample buyer", answers: (step.questions as Json[]).map((q) => ({ questionId: q.questionId ?? q.id, optionId: q.options[0].optionId ?? q.options[0].id })) })).step;
      else if (step.state === "options_ready") step = (await call("choose_option", { requestId, by: "Sample buyer", optionId: step.preselected?.optionId ?? step.options[0].optionId })).step;
      else break;
    }
    const placed = step?.state === "quoted" ? await call("place_order", { requestId }) : undefined;
    out.push(`accepted ${acc.offerId} → ${placed?.order?.orderId ?? step?.state}`);
    if (placed?.order?.orderId && placed.order.status === "pending_approval") await signOff(c, placed.order.orderId, "approve", "Yes, try it.").catch(() => undefined);
  }
  if (dec) {
    await offers.declineOffer(rt, await sessionOf(rt, dec.slug), dec.offerId, { by: "Sample buyer", via: "the sample activity", now: sampleNow() });
    out.push(`declined ${dec.offerId}`);
  }
  if (mute) {
    await offers.muteOffers(rt, await sessionOf(rt, mute.slug), { offerId: mute.offerId, scope: "product" }, { by: "Sample buyer", via: "the sample activity", now: sampleNow() });
    out.push(`muted ${mute.offerId}`);
  }
  // The same product again, after the mute: the selling agent holds it back for that kitchen (a guardrail), with the rule.
  const product = rt.catalogSource.kind === "valio" ? c.cast.milkSmall.id : "VA-1201";
  const again = await offers.startCampaign(rt, { productId: product, by: "Category manager (sample)", kitchens: c.sampleKitchens, now: sampleNow() }).catch(() => undefined);
  if (again) out.push(`campaign again: ${JSON.stringify((again as { results?: unknown[] }).results?.length ?? "")}`);
  return out.join("; ") || "no open offers to answer";
}

// ---------- closing ----------

/**
 * At the end of every play: nothing the sample did stays open in a kitchen a person can sign into. Its orders still
 * waiting there are taken back (the ledger says the sample did it), and anything it staged there is lifted. The
 * sample's own kitchens keep theirs.
 */
export async function closeOpen(c: Ctx): Promise<string> {
  const { rt } = c;
  const { isSampleOrder } = await import("./marks");
  const out: string[] = [];
  for (const slug of ["kaari", "laakso", ...TEST] as Who[]) {
    const { orgId } = await orgOf(rt, slug).catch(() => ({ orgId: "" }));
    if (!orgId) continue;
    const open = (await rt.dock.pendingOrders(orgId)).filter((o) => isSampleOrder(rt.dock.ledger, o));
    for (const o of open) {
      const who: Who = slug === "laakso" ? "laakso" : slug;
      const a = new RestAgent(await credentialsFor(rt, who, sampleNow()));
      const r = await a.call("POST", `/api/v1/orders/${o.orderId}/withdraw`, { reason: "The sample activity ended: nothing it played is left waiting in a kitchen people sign into.", by: "the sample activity" });
      out.push(`${o.orderId} ${r.body.order?.status ?? r.body.error?.code}`);
    }
  }
  const w = await import("@/server/watch/service");
  const testOrgs = new Set(await Promise.all(["kaari", "laakso", ...TEST].map(async (s) => (await orgOf(rt, s).catch(() => ({ orgId: "" }))).orgId)));
  for (const st of (await w.watchView(rt)).stages ?? []) {
    if (testOrgs.has(st.orgId) && !st.liftedAt) {
      await w.liftStage(rt, st.stageId, "the sample activity (its end)", sampleNow()).catch(() => undefined);
      out.push(`lifted ${st.stageId}`);
    }
  }
  return out.length ? out.join(", ") : "nothing was left open";
}


void play;
