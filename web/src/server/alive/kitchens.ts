import { addDaysIso, localNow } from "@/core/kitchen";
import type { AgentSession } from "@/core/orders";
import { POOR_RECORD } from "@/server/accounts/test-accounts";
import type { Runtime } from "@/server/runtime";
import type { Json } from "@/server/show/agent";
import { orderLines } from "@/server/show/agent";
import { RestAgent, credentialsFor, deliveryDay, mcpAgent, onsiteAgent, type Who } from "./agents";
import { play, playingNow, sampleNow } from "./clock";
import { sampleAgent, sampleReader, setTurnScript, type TurnScript } from "./models";
import { MIN, beat, describe, directOrder, intakeOrder, later, milkNeed, need, signOff, type Ctx } from "./story";

/**
 * The kitchens' side of the sample, as now (minutes and hours ago): the three shared test kitchens and the demo
 * kitchen Kaari, through the same engines a person's day goes through. Played again for the kitchens after the test
 * accounts' timed reset (each reset is a fresh organisation), so a kitchen's own pages are never empty.
 */
const TEST: Who[] = ["hotel-lumo", "koulu-metsola", "kahvila-sointu"];
const SAMPLE_ADDRESS = (slug: string) => `sample.${slug}@example.com`;

async function sessionOf(rt: Runtime, who: Who): Promise<AgentSession> {
  const c = await credentialsFor(rt, who, sampleNow());
  return rt.dock.authenticate(c.mandateToken, c.agentId, { via: "onsite", transport: "direct", path: "/sample", method: "POST" } as never);
}

async function orgOf(rt: Runtime, slug: string): Promise<{ orgId: string; name: string }> {
  if (slug === "kaari") return { orgId: "org_ravintola_kaari", name: "Ravintola Kaari" };
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
    const { confirmation } = await mail.setAddress(c.rt, { orgId: k.orgId, slug, name: k.name }, SAMPLE_ADDRESS(slug), { by: "Kitchen manager (sample)", via: "the sample activity", lang: slug === "koulu-metsola" ? "fi" : "en", now: sampleNow() });
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

// ---------- the conversation, its models scripted ----------

async function turn(slug: string, body: Json, script: TurnScript): Promise<Json[]> {
  const { submitTurn, threadStore } = await import("@/server/thread/engine");
  const store = await threadStore();
  setTurnScript(script);
  let id = "";
  const done = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 60_000);
    const off = store.subscribe(slug, (e) => {
      if (e.type !== "status" || e.turnId !== id || e.status === "working") return;
      clearTimeout(t);
      off();
      resolve();
    });
  });
  id = (await submitTurn(slug, body)).agentTurnId;
  await done;
  const t = store.peek(slug);
  return (t ? (store.agentTurn(t, id)?.cards ?? []) : []) as Json[];
}

async function withScriptedModels<T>(fn: () => Promise<T>): Promise<T> {
  const [{ setAgentModelForTests }, { setInterpretModelForTests }] = await Promise.all([import("@/server/thread/agent"), import("@/server/agent/interpret")]);
  setAgentModelForTests({ model: sampleAgent(), id: "sample:scripted-agent" });
  setInterpretModelForTests({ model: sampleReader(), id: "sample:scripted-reader" } as never);
  try {
    return await fn();
  } finally {
    setAgentModelForTests(undefined);
    setInterpretModelForTests(undefined);
    setTurnScript(undefined);
  }
}

const needOf = (o: { text: string; category: string; amount: number; unit: string; deliverBy: string; claims?: string[] }) => ({
  isPurchaseRequest: true,
  notPurchaseReason: null,
  item: { text: o.text, category: o.category, attributes: o.claims ?? [], excludedAttributes: [], productId: null },
  quantity: { amount: o.amount, unit: o.unit },
  deliverBy: o.deliverBy,
  requiredClaims: o.claims ?? [],
  forbiddenAllergens: [],
  optimise: "price",
  sameAsLastTime: false,
  basedOnRequestId: null,
  takenFromEarlier: [],
});

type Conversation = { lang?: "en" | "fi"; door?: "typed" | "voice"; turns: { words: string; need?: Parameters<typeof needOf>[0]; line: string; tap?: boolean; holdMs?: number }[] };

/** One conversation: the buyer's words, the agent's options, a tap on the first one (the order), the agent's line. */
async function converse(slug: string, conv: Conversation): Promise<string> {
  const door = conv.door ?? "typed";
  const out: string[] = [];
  for (const t of conv.turns) {
    const cards = await turn(slug, { door, via: door === "voice" ? "speech" : "typed", text: t.words, ...(conv.lang ? { lang: conv.lang } : {}) }, { words: t.words, need: t.need ? needOf(t.need) : undefined, line: t.line, order: !!t.need, ...(t.holdMs ? { holdMs: t.holdMs } : {}) });
    const options = cards.find((c) => c.type === "options");
    let order = cards.find((c) => c.type === "order");
    // Spoken words: the voice door reads an order the agent would place alone back first, and the buyer's yes
    // places it (thread/pipeline.ts spokenHold): the sample's buyer says it.
    if (door === "voice" && !order && cards.some((c) => c.type === "price")) {
      const yes = await turn(slug, { door, via: "speech", text: conv.lang === "fi" ? "Kyllä, tilaa se." : "Yes, order it.", ...(conv.lang ? { lang: conv.lang } : {}) }, { line: t.line });
      order = yes.find((c) => c.type === "order");
    }
    if (t.tap && options && !order) {
      const second = await turn(slug, { door, via: "tap", action: { type: "choose", requestId: options.requestId, optionId: options.preselected?.optionId ?? options.options[0].optionId }, label: conv.lang === "fi" ? "Tilaa tämä" : "Order this", ...(conv.lang ? { lang: conv.lang } : {}) }, { line: t.line });
      order = second.find((c) => c.type === "order");
    }
    const anomaly = cards.find((c) => c.type === "anomaly");
    out.push(order ? `${order.orderId} ${order.status ?? ""}`.trim() : `${cards.map((c) => c.type).join("+") || "no cards"}${anomaly ? ` [${(anomaly.concerns as Json[]).map((x) => `${x.code}: ${x.message}`).join("; ")}]` : ""}`);
  }
  return out.join("; ");
}

async function newConversation(rt: Runtime, slug: string): Promise<void> {
  const { threadStore } = await import("@/server/thread/engine");
  const store = await threadStore();
  const t = store.peek(slug);
  if (t?.turns.length) store.reset(slug, (await orgOf(rt, slug)).orgId);
}

// ---------- the kitchens ----------

/**
 * How far back a kitchen-side beat may go: not before the test kitchens' mandates became valid (a fresh in-memory
 * server signed them seconds ago; the watch and the selling agent act with the kitchen's own mandate).
 */
async function floorMs(rt: Runtime): Promise<number> {
  let floor = Infinity;
  for (const slug of TEST) {
    const k = (await rt.accounts.kitchenOf(slug))?.kitchen;
    if (k) floor = Math.min(floor, Date.now() - Date.parse(k.mandate.validFrom) - MIN);
  }
  return Math.max(0, Number.isFinite(floor) ? floor : 0);
}

export async function kitchens(c: Ctx): Promise<void> {
  const { rt, cast, ids } = c;
  const floor = await floorMs(rt);
  // Minutes ago on a server whose test kitchens signed their mandates long enough ago; squeezed into what they allow.
  const ago = (m: number) => Math.min(m * MIN, Math.round((floor * m) / 160));
  const lumo = async () => onsiteAgent(await credentialsFor(rt, "hotel-lumo", sampleNow()), "hotel-lumo", `sample-${c.setId}`);
  const LUMO_DAYS = [1, 2, 3, 4, 5, 6];
  await withSampleMail(rt, async () => {
    await beat(c, "mail: the test kitchens give an address (sample, nothing is sent)", ago(150), () => giveAddresses(c, TEST as string[]));

    await beat(c, "watch: hotel lumo's milk renewed by itself", ago(146), () => watchRenewal(c, "hotel-lumo", false));
    await beat(c, "watch: hotel lumo's breakfast cream crept up: renewal held", ago(144), () => heldRenewal(c, "hotel-lumo"));
    await beat(c, "watch: metsola's milk cannot come (staged): a substitute ordered", ago(142), () => watchRenewal(c, "koulu-metsola", true));
    await beat(c, "hotel lumo: breakfast milk, placed alone", ago(140), async () => {
      const d = await intakeOrder(await lumo(), milkNeed(360, deliveryDay(sampleNow(), 1, LUMO_DAYS)), "Kitchen manager");
      if (d.order) ids.lumoAlone = d.order.orderId;
      return describe(d);
    });

    await beat(c, "metsola school: an oat drink as the pupils' milk (nutrition rule)", ago(120), async () => {
      const p = need(cast.lowProteinDrink, "no plant drink below milk's protein in this catalogue");
      const d = await directOrder(new RestAgent(await credentialsFor(rt, "koulu-metsola", sampleNow())), `20 packs of ${p.name} for lunch`, deliveryDay(sampleNow(), 1), [{ productId: p.id, quantity: 20 }]);
      if (d.order) ids.nutritionRefused = d.order.orderId;
      return describe(d);
    });

    await beat(c, "metsola school: milk for the week, placed alone", ago(112), async () => describe(await intakeOrder(onsiteAgent(await credentialsFor(rt, "koulu-metsola", sampleNow()), "koulu-metsola", `sample-${c.setId}`), milkNeed(60, deliveryDay(sampleNow(), 1)), "Food service manager")));

    // Kahvila Sointu: a small order the agent may place alone (under its €60), and one more the same day, which the
    // gate counts together with it (no splitting one need into small orders): that one goes to the owner.
    const sointu = async () => onsiteAgent(await credentialsFor(rt, "kahvila-sointu", sampleNow()), "kahvila-sointu", `sample-${c.setId}`);
    await beat(c, "kahvila sointu: milk for the coffee, alone", ago(100), async () => describe(await intakeOrder(await sointu(), milkNeed(36, deliveryDay(sampleNow(), 1, [2, 5])), "Owner")));
    await beat(c, "kahvila sointu: more milk the same day, to the owner", ago(8), async () => {
      const d = await intakeOrder(await sointu(), milkNeed(30, deliveryDay(sampleNow(), 1, [2, 5])), "Owner");
      if (d.order?.status === "pending_approval") ids.sointuWaiting = d.order.orderId;
      return describe(d);
    });

    await beat(c, "watch: a product with a poor delivery record, its backup used", ago(58), () => backupUsed(c, ago(52)));
    await beat(c, "selling agent: a campaign and a run over the kitchens", ago(50), () => sellingAgent(c));
    await beat(c, "selling agent: the kitchens answer (accept, decline, mute)", ago(44), () => answerOffers(c));
    // What needs the kitchen today: an order over its limit, waiting for the kitchen manager's passkey now.
    await beat(c, "hotel lumo: over its limit, waiting for the kitchen manager", ago(6), async () => {
      const d = await intakeOrder(await lumo(), milkNeed(560, deliveryDay(sampleNow(), 2, LUMO_DAYS)), "Kitchen manager: the conference weekend");
      if (d.order?.status === "pending_approval") ids.lumoWaiting = d.order.orderId;
      return describe(d);
    });

    await withScriptedModels(async () => {
      const day = (n: number, w = [1, 2, 3, 4, 5]) => deliveryDay(new Date(), n, w);
      const plan: [Who, Conversation[]][] = [
        ["hotel-lumo", [
          { turns: [{ words: "What do we usually order for Saturday breakfast?", line: "Lactose-free milk in 10 L boxes, about 400 L every Monday and Thursday, and breakfast cream. Your rule: always lactose-free." }] },
          { turns: [{ words: `6 litres of lactose-free whipping cream for ${day(2, [1, 2, 3, 4, 5, 6])}`, need: { text: "lactose-free whipping cream", category: "cream", amount: 6, unit: "L", deliverBy: day(2, [1, 2, 3, 4, 5, 6]), claims: ["lactose_free"] }, line: "Ordered. It is within what I may spend alone.", tap: true }] },
          { door: "voice", turns: [{ words: `Ten kilos of lactose-free natural yoghurt for ${day(3, [1, 2, 3, 4, 5, 6])}`, need: { text: "lactose-free natural yoghurt", category: "yoghurt", amount: 10, unit: "kg", deliverBy: day(3, [1, 2, 3, 4, 5, 6]), claims: ["lactose_free"] }, line: "Done: ten kilos, lactose-free, as always.", tap: true }] },
        ]],
        ["koulu-metsola", [
          { lang: "fi", turns: [{ words: `Tarvitsemme 24 kiloa maustamatonta jogurttia ${day(2)}`, need: { text: "maustamaton jogurtti", category: "yoghurt", amount: 24, unit: "kg", deliverBy: day(2) }, line: "Tilattu: 24 kiloa maustamatonta jogurttia tiistain lounaalle.", tap: true }] },
          { turns: [{ words: "Is anything nut-free that we could use instead of the yoghurt?", line: "Your rules already keep everything nut-free: every product I suggest is checked against them before it reaches you." }] },
          { turns: [{ words: "When does the lollo rosso for Wednesday's salad bar come?", line: "Wednesday morning, ordered on Monday as usual. Its delivery record is weak, so a backup is lined up in case it does not come." }] },
        ]],
        ["kahvila-sointu", [
          { turns: [{ words: "How much of this week's budget is left?", line: "Plenty: about €340 of the €400 is left for this week. One milk order waits for the owner's OK because it came on top of another the same day." }] },
          { turns: [{ words: `12 litres of oat drink for ${day(1, [2, 5])}`, need: { text: "oat drink", category: "plant_drink", amount: 12, unit: "L", deliverBy: day(1, [2, 5]) }, line: "Ordered: the barista oat drink, as usual.", tap: true }] },
          { turns: [{ words: "Thanks, that's all for today.", line: "Have a good day. I will tell you if anything for Friday cannot come." }] },
        ]],
      ];
      for (const [slug, convs] of plan) {
        await beat(c, `conversations: ${slug}`, 0, async () => {
          const out: string[] = [];
          for (const conv of convs) {
            await newConversation(rt, slug);
            out.push(await converse(slug, conv));
          }
          return out.join(" | ");
        });
      }
      await slowTurnBeat(c);
    }).catch((err: Error) => c.beats.push({ name: "conversations", ok: false, detail: err.message, ms: 0 }));

    await beat(c, "mail: the sample addresses removed", 0, () => removeAddresses(c, TEST as string[]));
  });
}

/**
 * Slow turns (the scripted agent held for 21 s), so the Platform page shows what a breaching alert looks like for the
 * next 15 minutes. They run on in the background: the seed does not wait for them.
 */
async function slowTurnBeat(c: Ctx): Promise<void> {
  await beat(c, "conversations: two slow turns (alert)", 0, async () => {
    if (!c.slowTurnMs) return "skipped";
    // Two, in two kitchens at once: the alert reads the 90th percentile of the last 15 minutes' turns.
    for (const slug of ["kahvila-sointu", "koulu-metsola"]) void converse(slug, { turns: [{ words: "Is the Friday delivery still on time?", line: "Yes: the cut-off for Friday is Thursday at 11:00, and nothing is late.", holdMs: c.slowTurnMs }] }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 600));
    return `started, held ${c.slowTurnMs} ms each`;
  });
}

/** Only the slow turn again (the operations portal's top-up, start.ts). */
export async function slowTurn(c: Ctx): Promise<void> {
  await withScriptedModels(() => slowTurnBeat(c)).catch((err: Error) => c.beats.push({ name: "slow turn", ok: false, detail: err.message, ms: 0 }));
}

/** What waits for the test kitchens now (the top-up): Hotel Lumo's order over its limit. */
export async function kitchenWaiting(c: Ctx): Promise<void> {
  await beat(c, "hotel lumo: over its limit, waiting for the kitchen manager", 4 * MIN, async () => {
    const d = await intakeOrder(onsiteAgent(await credentialsFor(c.rt, "hotel-lumo", sampleNow()), "hotel-lumo", `sample-${c.setId}`), milkNeed(560, deliveryDay(sampleNow(), 2, [1, 2, 3, 4, 5, 6])), "Kitchen manager: the conference weekend");
    if (d.order?.status === "pending_approval") c.ids.lumoWaiting = d.order.orderId;
    return describe(d);
  });
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
  return `${p.family}: renewal ${done?.state ?? "none"} ${done?.outcome?.orderId ?? ""}${f ? `; finding ${f.findingId} with ${f.substitutes.length} substitutes` : ""}${r.note ? ` (${r.note})` : ""} ${JSON.stringify(r.renewals.map((x) => [x.family, x.state, x.decision?.reason]))}`.slice(0, 500);
}

async function heldRenewal(c: Ctx, slug: Who): Promise<string> {
  const { rt } = c;
  const w = await import("@/server/watch/service");
  const { orgId } = await orgOf(rt, slug);
  const session = await sessionOf(rt, slug);
  const p = (await w.standingFor(rt, orgId, sampleNow())).find((x) => x.drifted && x.next);
  if (!p) throw new Error(`${slug}: no recurring order that drifted`);
  await w.setAutoRenew(rt, session, { family: p.family, on: true, by: "Kitchen manager (sample)", via: "the sample activity", renewNow: false, now: sampleNow() });
  const [r] = await w.runWatch(rt, { kitchens: [slug], fresh: true, renew: "now", now: sampleNow() });
  const done = r.renewals.find((x) => x.family === p.family);
  return `${p.family}: renewal ${done?.state ?? "none"}: ${done?.decision.reason ?? ""}${r.note ? ` (${r.note})` : ""} ${JSON.stringify(r.renewals.map((x) => [x.family, x.state]))}`.slice(0, 400);
}

/** A kitchen orders a product whose delivery record is poor, lines up the backup it is offered; the product cannot come: the watch orders the backup. */
async function backupUsed(c: Ctx, laterMs: number): Promise<string> {
  const { rt } = c;
  const real = rt.catalogSource.kind === "valio";
  const slug: Who = real ? "hotel-lumo" : "kaari";
  const productId = real ? POOR_RECORD.lumo : "JP-3010";
  const session = await sessionOf(rt, slug);
  const { backupMomentForThread, answerBackup } = await import("@/server/reliability/thread");
  const w = await import("@/server/watch/service");
  const req = await rt.dock.openRequest(session, { text: `4 packs of ${productId}`, neededBy: addDaysIso(localNow(sampleNow()).date, 3), productIds: [productId] });
  const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: 4 }] });
  const first = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  if (first.status === "pending_approval") await signOff(c, first.orderId, "approve", "Fine.").catch(() => undefined);
  const m = await backupMomentForThread(rt, session, { orderId: first.orderId }, "en");
  if (!m) return `${first.orderId} ${first.status}: no backup offered (its delivery record is not poor here)`;
  await answerBackup(rt, session, m.id, "you_choose", { by: "Kitchen manager (sample)", via: "the sample activity", lang: "en" });
  await later(c, laterMs, async () => {
    await w.stageStockOut(rt, { kitchen: slug, productId, by: "Operations (sample)", now: sampleNow() });
    await w.runWatch(rt, { kitchens: [slug], fresh: true, now: sampleNow() });
  });
  return `${first.orderId} ${first.status}; backup lined up and used`;
}

// ---------- the selling agent ----------

async function sellingAgent(c: Ctx): Promise<string> {
  const { rt, cast } = c;
  const offers = await import("@/server/offers/service");
  const product = rt.catalogSource.kind === "valio" ? cast.milkSmall.id : "VA-1201";
  const camp = await offers.startCampaign(rt, { productId: product, by: "Category manager (sample)", listAsNew: true, now: sampleNow() });
  const run = await offers.runSellingAgent(rt, { now: sampleNow(), by: "the sample activity" });
  const offered = run.reduce((s, r) => s + r.offered.length, 0);
  const withheld = run.reduce((s, r) => s + r.withheld.length, 0);
  return `campaign ${camp.campaignId ?? ""}; run: ${offered} offered, ${withheld} held back by a guardrail`;
}

async function answerOffers(c: Ctx): Promise<string> {
  const { rt } = c;
  const offers = await import("@/server/offers/service");
  const out: string[] = [];
  const slugs: Who[] = ["kaari", ...TEST];
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
  return out.join("; ") || "no open offers to answer";
}

void orderLines;
void play;
