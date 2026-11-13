/**
 * Scripted buyer agent. No LLM: fixed logic playing Valio Aimo's example "I need 1,000 litres of lactose-free milk
 * by Monday" through the structured intake, then a returning restaurant kitchen (mistake check, options from
 * memory, "same as last time"), then a run of attempts to make the agent misbehave.
 *
 * Catalogue: the partner's real one when the index exists (`pnpm index:build`) and VALIO_API_KEY is set in
 * .env.local, with a few live price/availability calls per run; otherwise the 12-product seed. Products are
 * chosen by attribute, never by id, so the same script runs on both. DOCK_CATALOG=seed forces the seed.
 *
 *   pnpm demo                         all three runs, in-process (no server needed)
 *   pnpm demo happy | kitchen | attacks   one run
 *   pnpm demo --url http://localhost:3000   the same against a running `pnpm dev` (fills the page at /)
 */
import { base64url, compactVerify, importJWK, type CryptoKey } from "jose";
import { verifyClaim } from "@/core/claims";
import { signMandate, type Mandate } from "@/core/mandate";
import { verifyLedger, type LedgerEntry } from "@/core/ledger";
import { addDays, formatEur } from "@/core/util";
import { generateEd25519KeyPair } from "@/core/keys";
import { formatDay, localNow, nextDeliveryDay } from "@/core/kitchen";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { localFetch } from "@/server/local-transport";
import { shutdownAiven } from "@/server/aiven";
import { getRuntime } from "@/server/runtime";
import { scenarioNeed } from "@/server/sandbox-scenario";
import { DockClient, type Offer, type OptionCard, type Product, type Reply, type Step } from "./lib/client";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv(); // VALIO_API_KEY from .env.local: the real catalogue when its index is built

const args = process.argv.slice(2);
const urlFlag = args.indexOf("--url");
const baseUrl = urlFlag >= 0 ? args[urlFlag + 1] : "http://dock.local";
const which = args.find((a) => a === "happy" || a === "kitchen" || a === "attacks") ?? "all";
const base = new DockClient(urlFlag >= 0 ? (req) => fetch(req) : localFetch, baseUrl);

const say = (s = "") => console.log(s);
const step = (n: string, s: string) => say(`\n[${n}] ${s}`);
const indent = (lines: string[], pad = "      ") => lines.forEach((l) => say(pad + l));

async function mandateToken(overrides: Partial<Mandate> = {}): Promise<string> {
  return signMandate(demoMandate(new Date(), overrides), await demoOrgKeyPair());
}

const LAAKSO = "Aino Virtanen (kitchen manager)";

/** Verify signed claims offline against the wholesaler's published keys, as an outside agent would. */
async function verifyClaimsOffline(tokens: { token: string }[]): Promise<string[]> {
  const { keys } = (await base.keys()).body as { keys: (Record<string, string> & { kid: string })[] };
  const verifying = await Promise.all(keys.map(async (k) => ({ kid: k.kid, publicKey: (await importJWK(k, "Ed25519")) as CryptoKey })));
  const out: string[] = [];
  for (const { token } of tokens) {
    const c = await verifyClaim(token, verifying);
    const st = c.statement as Record<string, unknown>;
    const what =
      c.type === "price"
        ? `${formatEur(Number(st.unitPriceCents))} per ${String(st.per)}${st.customerSpecific ? " (customer price)" : ""}`
        : c.type === "availability"
          ? `delivery ${String(st.deliveryDate)}${st.orderBy ? ` if ordered by ${String(st.orderBy).slice(0, 16).replace("T", " ")}` : ""}, stock ${(st.stock as { known: boolean; packs: number | null }).known ? (st.stock as { packs: number }).packs : "not reported"}`
          : `origin ${String(st.countryOfOrigin ?? "not stated")}, labels ${(st.labels as string[]).join(", ") || "none"}`;
    out.push(`${c.type.padEnd(12)} ${c.productId}: ${what}; from ${c.source}, valid until ${c.validUntil.slice(0, 16).replace("T", " ")} UTC  (signature OK)`);
  }
  return out;
}

async function happyPath(): Promise<void> {
  say("=".repeat(78));
  say(" RUN 1  The partner's example: 1,000 litres of lactose-free milk by Monday");
  say("=".repeat(78));

  const m = demoMandate(new Date());
  const agent = base.as(await mandateToken(), DEMO_ORG.agentId);
  step("mandate", `${m.issuer.name} signed a mandate for agent ${m.agentId} (Ed25519 JWS):`);
  indent([
    `alone up to ${formatEur(m.perOrderLimitCents)} per order, hard weekly budget ${formatEur(m.weeklyBudgetCents)}`,
    `categories ${m.allowedCategories.join(", ")}; must be ${m.requiredAttributes.join(", ")}; never ${m.forbiddenAllergens.join(", ")}`,
    `substitutes: ${m.substitution.rule}, at most +${m.substitution.maxPriceIncreasePct} % per litre; delivery within ${m.delivery.maxLeadDays} days`,
    `approvers: ${m.approvers.map((a) => `${a.name} (${a.role}, up to ${formatEur(a.maxApprovalCents)})`).join(", ")}`,
  ]);

  // The agent's model turns the sentence into fields; here that step is fixed. Nothing about fat or pack size.
  const need = scenarioNeed();
  const callsBefore = (await base.ledger()).body.catalog.liveCalls;
  let s = (await agent.intakeOpen(need, LAAKSO)).body.step;
  step("request", `"${need.text}"  ->  ${need.quantity.amount} L, lactose_free, by ${formatDay(need.deliverBy)}, optimise price. Request ${s.requestId}.`);
  let interruptions = 0;
  while (s.state === "needs_confirmation" || s.state === "needs_input") {
    interruptions += 1;
    step(s.state, "Dock stops the buyer:");
    showStep(s);
    s = s.state === "needs_confirmation" ? await settle(agent, s, LAAKSO) : (await agent.intakeAnswers(s.requestId, LAAKSO, s.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })))).body.step;
  }
  const cutoffs = (s.excluded ?? []).filter((e) => e.code === "cutoff_passed");
  const lookups = (await base.ledger({ requestId: s.requestId })).body.catalog.liveCalls - callsBefore;
  step("lookup", `${lookups} live call${lookups === 1 ? "" : "s"} for short lists of at most 10 products. ${cutoffs.length ? "Order cut-off already passed for:" : "No passed cut-offs."}`);
  indent(cutoffs.map((e) => `${e.productId}: ${e.reason}`));
  if (s.state === "options_ready") {
    step("options", `Buyer interrupted ${interruptions} time${interruptions === 1 ? "" : "s"} before the options. Good, better, best:`);
    showStep(s);
    const pick = s.preselected?.optionId ?? s.options[0].optionId;
    s = (await agent.intakeChoice(s.requestId, LAAKSO, pick)).body.step;
    step("choice", `${LAAKSO} picks ${pick}${s.chosen ? "" : " (refused?)"}.`);
  } else if (s.state === "quoted") {
    step("options", `Buyer interrupted ${interruptions} times; the request decided the choice (a full match at the best price).`);
  }
  if (s.state !== "quoted" || !s.quote) return void showStep(s);
  const { quote, quoteToken, policyPreview } = s.quote;
  step("quote", `Wholesaler signed quote ${quote.quoteId}: ${quote.lines.map((l) => `${l.quantity} x ${l.productId}`).join(" + ")} = ${formatEur(quote.totalCents)}, price fixed until ${quote.expiresAt.slice(0, 16).replace("T", " ")} UTC (${quote.expiresBecause ?? "ttl"}). Gate preview: ${policyPreview.outcome}.`);

  const claims = s.quote.claims ?? [];
  step("claims", `Quote rests on ${quote.evidence?.length ?? 0} signed claims (W3C VC, vc+jwt), handed out with it. An outside agent checks them offline:`);
  indent(await verifyClaimsOffline(claims));

  const placed = await agent.placeOrder(s.requestId, quoteToken, quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })));
  const order = placed.body.order;
  step("decision", `HTTP ${placed.status}: ${order.decision.outcome}`);
  indent(order.decision.reasons.map((r) => `- ${r}`));

  const msg = (await base.outbox()).body.messages.find((x) => x.orderId === order.orderId);
  if (msg) {
    step("approval", `Message to ${msg.approver.name}'s phone (not to the agent): ${baseUrl}${msg.link.replace(/token=.*/, "token=…")}`);
    indent(msg.reasons.slice(-2).map((r) => `- ${r}`));
    const decided = await base.decide(msg.approvalId, "approve", new URL(msg.link, baseUrl).searchParams.get("token")!, "OK for Monday.");
    step("approval", `${msg.approver.name} approved. HTTP ${decided.status}: order ${decided.body.order.status}.`);
  }
  const final = (await agent.getOrder(order.orderId)).body.order;
  if (final.confirmation) {
    const jwk = (await base.keys()).body.keys[0];
    const { payload } = await compactVerify(final.confirmation, (await importJWK(jwk, "Ed25519")) as CryptoKey);
    const confirmation = JSON.parse(new TextDecoder().decode(payload));
    step("order", `Committed ${final.orderId}, ${formatEur(final.totalCents)}. Confirmation signature verified against the wholesaler's published key.`);
    indent([`authorised by: ${confirmation.authorisedBy.kind === "mandate" ? "the mandate" : `${confirmation.authorisedBy.name} (${confirmation.authorisedBy.role})`}; ledger head at commit: #${confirmation.ledgerHead.seq}`]);
  }

  const ledger = (await base.ledger({ requestId: s.requestId })).body;
  step("ledger", `Buyer's view (chain verified: ${ledger.verification.ok}):`);
  indent(ledger.explanation);
  const wholesaler = (await base.ledger({ requestId: s.requestId, view: "wholesaler" })).body;
  step("ledger", "Wholesaler's view of the same chain (no kitchen memory):");
  indent(wholesaler.explanation);
  say(`\n      Buyer interruptions before options: ${interruptions}. Live price/availability calls for this request: ${ledger.catalog.liveCalls - callsBefore} (partner HTTP so far: ${JSON.stringify(ledger.catalog.upstream ?? "seed, none")}).`);
}

// ---------- RUN 2: a returning kitchen through the structured intake ----------

const SANNA = "Sanna Koskinen (head chef)";

function showStep(s: Step): void {
  if (s.state === "needs_confirmation") {
    for (const c of s.concerns) {
      say(`      ! ${c.code} (${c.severity}): ${c.message}`);
      indent([...c.corrections.map((x) => `[${x.id}] ${x.label}`), ...(c.confirmable ? ["[confirm] Yes, that is what I meant"] : [])], "          ");
    }
  }
  indent(s.rules.filter((r) => r.source === "stated").map((r) => `rule from memory: ${r.text}`));
  indent(s.fromMemory.map((m) => `from memory (${m.source}): ${m.question.text} ${m.label}. ${m.text}`));
  if (s.state === "needs_input") {
    for (const q of s.questions) say(`      ? ${q.text}  ${q.options.map((o) => `[${o.id}] ${o.label}`).join("  ")}`);
  }
  if (s.state === "options_ready") {
    s.options.forEach(showCard);
    if (s.preselected) say(`      pre-selected: ${s.preselected.optionId} (${s.preselected.reason})`);
  }
  for (const n of s.notes) say(`      note: ${n}`);
  for (const n of s.signOffNotes ?? []) say(`      for the approver: ${n}`);
}

function showCard(c: OptionCard): void {
  const co2 = c.co2.kg === null ? "no carbon data" : `${c.co2.kg} kg CO2e (product-group average)`;
  const rel = c.reliability === null ? "no reliability data" : `${Math.round(c.reliability * 100)} % delivered in full`;
  const head = [c.rank?.toUpperCase(), c.match === "compromise" ? `COMPROMISE (gives up ${c.givesUp!.map((g) => g.part.replace("_", " ")).join(", ")})` : undefined, c.labels.map((l) => l.replaceAll("_", " ")).join(" + ")].filter(Boolean).join("  ");
  say(`      ${c.optionId}  ${head}`);
  say(`             ${c.title}`);
  say(`             ${c.lines.map((l) => `${l.packs} x ${l.productId}`).join(" + ")}  ${formatEur(c.totalCents)}  delivery ${formatDay(c.deliveryDate)}${c.orderBy ? ` (order by ${c.orderBy.slice(0, 16).replace("T", " ")})` : ""}  ${co2}  ${rel}`);
  indent([...c.pros.map((p) => `+ ${p}`), ...c.cons.map((x) => `- ${x}`)], "             ");
}

/** Place the quoted order; if it needs a sign-off, the head chef approves it from the link on her phone. */
async function orderAndApprove(agent: DockClient, s: Step): Promise<void> {
  const placed = await agent.placeOrder(s.requestId, s.quote!.quoteToken, s.quote!.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })));
  const order = placed.body.order;
  step("decision", `HTTP ${placed.status}: ${order.decision.outcome}`);
  indent(order.decision.reasons.map((r) => `- ${r}`));
  if (order.status !== "pending_approval") return;
  const msg = (await base.outbox()).body.messages.find((x) => x.orderId === order.orderId);
  if (!msg) return void say("      No approval message found (is the server in production mode?).");
  const decided = await base.decide(msg.approvalId, "approve", new URL(msg.link, baseUrl).searchParams.get("token")!, "Fine.");
  step("approval", `${msg.approver.name} approved on her phone. HTTP ${decided.status}: order ${decided.body.order.status}, ${formatEur(decided.body.order.totalCents)}.`);
}

/** Confirm anything left from an earlier run against the same server (e.g. a duplicate), so the script can go on. */
async function settle(agent: DockClient, s: Step, who = SANNA): Promise<Step> {
  if (s.state !== "needs_confirmation") return s;
  const responses = s.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id }));
  return (await agent.intakeConcerns(s.requestId, who, responses)).body.step;
}

async function returningKitchen(): Promise<void> {
  say("\n" + "=".repeat(78));
  say(" RUN 2  A returning kitchen: mistake check, options from memory, same as last time");
  say("=".repeat(78));
  const token = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  const agent = base.as(token, KITCHEN_ORG.agentId);

  const k = (await agent.kitchen()).body.kitchen;
  step("memory", `What Dock remembers about ${k.name}:`);
  for (const f of k.families) {
    const last = f.lastOrder;
    say(`      ${f.family}: ${f.orders} orders, ${f.usual.text}; last time ${last.lines.map((l) => `${l.packs} x ${l.productId}`).join(" + ")} on ${formatDay(last.placedAt.slice(0, 10))}`);
    indent(f.learned.map((l) => `learned (pre-selects only): ${l.text}`), "        ");
  }
  indent(k.stated.map((p) => `stated rule: "${p.text}", set by ${p.statedBy}`));

  // Three upcoming delivery days, at least two days out so the cut-off is never in the way.
  const days: string[] = [];
  let d = nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!;
  while (days.length < 3) {
    d = nextDeliveryDay(d, [1, 2, 3, 4, 5])!;
    days.push(d);
  }

  // (a) 1,000 litres where the kitchen usually takes about 100.
  say("\n  (a) The agent sends 1,000 L where the kitchen usually orders about 100 L.");
  let s = (await agent.intakeOpen({ text: "1000 litres of lactose-free milk for " + formatDay(days[0]), item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: days[0] }, SANNA)).body.step;
  step(s.state, `Before any price lookup, Dock asks:`);
  showStep(s);
  const tenfold = s.concerns.find((c) => c.code === "quantity_tenfold");
  if (tenfold) {
    s = (await agent.intakeConcerns(s.requestId, SANNA, [{ key: tenfold.key, choice: tenfold.corrections[0].id }])).body.step;
    step(s.state, `${SANNA} taps "${tenfold.corrections[0].label}": the request is now ${s.need.quantity?.amount} ${s.need.quantity?.unit}. Memory answers the rest:`);
    showStep(s);
    say("      (the kitchen leaves this one here)");
  }

  // (b) No stated preference: one question, three options, one chosen, quoted, approved.
  say(`\n  (b) "100 litres of milk for ${formatDay(days[1])}", nothing said about price or CO2.`);
  s = await settle(agent, (await agent.intakeOpen({ item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: days[1] }, SANNA)).body.step);
  step(s.state, `Dock asks ${s.questions.length} question${s.questions.length === 1 ? "" : "s"}; the rest comes from memory:`);
  showStep(s);
  const requestB = s.requestId;
  if (s.state === "needs_input") {
    s = (await agent.intakeAnswers(s.requestId, SANNA, s.questions.map((q) => ({ questionId: q.id, optionId: "no_preference" })))).body.step;
    step(s.state, `${SANNA} answers "no preference". ${s.options.length} option${s.options.length === 1 ? "" : "s"}, pros and cons computed from the data:`);
    showStep(s);
  }
  if (s.state === "options_ready") {
    const pick = s.options.find((o) => o.labels.includes("best_price")) ?? s.options[0];
    s = (await agent.intakeChoice(s.requestId, SANNA, pick.optionId)).body.step;
    step("quoted", `${SANNA} picks ${pick.optionId}. Wholesaler signed quote ${s.quote!.quote.quoteId}: ${formatEur(s.quote!.quote.totalCents)}. Gate preview: ${s.quote!.policyPreview.outcome}.`);
    await orderAndApprove(agent, s);
  }

  // (c) "Same as last time", in one call.
  say(`\n  (c) "Same as last time, for ${formatDay(days[2])}."`);
  s = await settle(agent, (await agent.intakeOpen({ item: { text: "milk", category: "milk" }, sameAsLastTime: true, deliverBy: days[2] }, SANNA)).body.step);
  step(s.state, s.state === "quoted" ? `One call: ${s.quote!.quote.lines.map((l) => `${l.quantity} x ${l.productId}`).join(" + ")} for ${formatEur(s.quote!.quote.totalCents)}, quote ${s.quote!.quote.quoteId}.` : "Not possible in one step:");
  if (s.state === "quoted") {
    indent(s.notes);
    await orderAndApprove(agent, s);
  } else showStep(s);

  const ledger = (await base.ledger({ requestId: requestB })).body;
  step("ledger", `Request (b), every step in plain language (chain verified: ${ledger.verification.ok}):`);
  indent(ledger.explanation);
}

type Attempt = { name: string; reply: Reply };

/** Products for the attacks, chosen by attribute from whatever catalogue is running, and checked live once. */
async function attackProducts(agent: DockClient, requestId: string, m: Mandate) {
  const search = async (q: { q?: string; category: string; attributes?: string[] }) => (await agent.search(requestId, q)).body.products ?? [];
  const plain = (p: Product) => (p.kinds ?? []).length === 0;
  const litres = (await search({ category: "milk", attributes: ["lactose_free", "fat_1_5"] })).filter((p) => plain(p) && p.unit === "L");
  const regular = (await search({ category: "milk" })).filter((p) => plain(p) && p.unit === "L" && !p.attributes.includes("lactose_free"));
  const drinks = await search({ category: "plant_drink", attributes: m.requiredAttributes });
  const allergen = drinks.filter((p) => p.allergens.some((a) => m.forbiddenAllergens.includes(a)));
  // Small packs first: the attacks order a handful, and single cartons are the items the wholesaler keeps in stock.
  const small = (xs: Product[]) => [...xs].sort((a, b) => a.packSize - b.packSize || a.id.localeCompare(b.id));
  const ids = [...small(litres).slice(0, 5), ...small(regular).slice(0, 3), ...allergen.slice(0, 2)].map((p) => p.id);
  const offers = (await agent.availability(requestId, ids)).body.offers ?? [];
  const byId = new Map([...litres, ...regular, ...allergen].map((p) => [p.id, p]));
  const offered = (ps: Product[]) => ps.filter((p) => offers.some((o) => o.productId === p.id));
  const perLitre = (p: Product) => offers.find((o) => o.productId === p.id)!.unitPriceCents / p.packSize;
  const milk = offered(litres).sort((a, b) => perLitre(a) - perLitre(b));
  return { milk, regular: offered(regular)[0], allergen: offered(allergen)[0], offerOf: (id: string) => offers.find((o) => o.productId === id) as Offer, perLitre, byId, all: ids };
}

async function attacks(): Promise<void> {
  say("\n" + "=".repeat(78));
  say(" RUN 3  Trying to make the agent misbehave");
  say("=".repeat(78));
  const token = await mandateToken();
  const m = demoMandate(new Date());
  const agent = base.as(token, DEMO_ORG.agentId);
  const requestId = (await agent.openRequest("Restock milk and plant drinks for the week.")).body.request.requestId;
  const results: Attempt[] = [];
  const pick = (q: { quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] } }) =>
    q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

  async function tryOrder(name: string, lines: { productId: string; quantity: number; substituteFor?: string }[]) {
    const q = await agent.quote(requestId, lines);
    if (q.status !== 201) return results.push({ name, reply: q });
    results.push({ name, reply: await agent.placeOrder(requestId, q.body.quoteToken, pick(q.body)) });
    return q.body;
  }

  const P = await attackProducts(agent, requestId, m);
  const cheap = P.milk[0];
  if (!cheap) return void say("      No orderable lactose-free milk right now: the attacks need one.");
  const price = P.offerOf(cheap.id).unitPriceCents;
  const packsFor = (cents: number) => Math.max(1, Math.ceil(cents / price));
  // For the big amounts: a product with enough stock (or none reported) for well over the weekly budget.
  const roomy = P.milk.find((x) => { const o = P.offerOf(x.id); return o.stockKnown === false || o.availablePacks * o.unitPriceCents > m.weeklyBudgetCents + 30_000; }) ?? cheap;
  const roomyPrice = P.offerOf(roomy.id).unitPriceCents;
  const roomyPacks = (cents: number) => Math.max(1, Math.ceil(cents / roomyPrice));
  step("products", `Chosen by attribute from the catalogue, checked live once: ${cheap.id} (${cheap.name}, ${formatEur(price)}/pack)${P.regular ? `, regular milk ${P.regular.id}` : ""}${P.allergen ? `, ${P.allergen.id} (contains ${P.allergen.allergens.filter((a) => m.forbiddenAllergens.includes(a)).join(", ")})` : ""}.`);

  // 0. A legitimate small order the agent may place alone.
  const smallQuote = await agent.quote(requestId, [{ productId: cheap.id, quantity: packsFor(3_000) }]);
  const small = await agent.placeOrder(requestId, smallQuote.body.quoteToken, pick(smallQuote.body));
  step("ok", `Small order inside the mandate: HTTP ${small.status}, ${small.body.order.status} without anyone being asked (${small.body.order.decision.reasons[0]})`);

  // 1. Replay the quote that was just used.
  results.push({ name: "Reuse a quote that already bought something", reply: await agent.placeOrder(requestId, smallQuote.body.quoteToken, pick(smallQuote.body)) });

  // 2. Over the weekly budget.
  await tryOrder(`Order ${formatEur(roomyPacks(m.weeklyBudgetCents + 20_000) * roomyPrice)} against a ${formatEur(m.weeklyBudgetCents)} weekly budget`, [{ productId: roomy.id, quantity: roomyPacks(m.weeklyBudgetCents + 20_000) }]);

  // 3. Forbidden allergen.
  if (P.allergen) await tryOrder(`Buy ${P.allergen.name}, which contains ${P.allergen.allergens.filter((a) => m.forbiddenAllergens.includes(a)).join(", ")}`, [{ productId: P.allergen.id, quantity: 5 }]);
  else results.push({ name: "Buy a drink with a forbidden allergen (none orderable now: skipped)", reply: { status: 0, body: {} } });

  // 4. Not lactose-free.
  if (P.regular) await tryOrder("Buy regular (not lactose-free) milk", [{ productId: P.regular.id, quantity: 2 }]);
  else results.push({ name: "Buy regular milk (none orderable now: skipped)", reply: { status: 0, body: {} } });

  // 5. Substitute far above the price tolerance.
  const dear = [...P.milk].reverse().find((p) => (P.perLitre(p) / P.perLitre(cheap) - 1) * 100 > m.substitution.maxPriceIncreasePct);
  if (dear) await tryOrder(`Substitute at +${Math.round((P.perLitre(dear) / P.perLitre(cheap) - 1) * 100)} % per litre (tolerance ${m.substitution.maxPriceIncreasePct} %)`, [{ productId: cheap.id, quantity: 2 }, { productId: dear.id, quantity: 2, substituteFor: cheap.id }]);
  else results.push({ name: "Substitute above the price tolerance (no such pair priced now: skipped)", reply: { status: 0, body: {} } });

  // 6. Change the price on the order.
  const q6 = await agent.quote(requestId, [{ productId: cheap.id, quantity: 2 }]);
  results.push({ name: "Order at €0.01 instead of the quoted price", reply: await agent.placeOrder(requestId, q6.body.quoteToken, [{ productId: cheap.id, quantity: 2, unitPriceCents: 1 }]) });

  // 7. Forge the quote itself.
  const [h, p, sig] = q6.body.quoteToken.split(".");
  const body = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
  body.lines[0].unitPriceCents = 1;
  body.lines[0].lineTotalCents = 2;
  body.totalCents = 2;
  const forged = [h, base64url.encode(JSON.stringify(body)), sig].join(".");
  results.push({ name: "Edit the price inside the signed quote", reply: await agent.placeOrder(requestId, forged, [{ productId: cheap.id, quantity: 2, unitPriceCents: 1 }]) });

  // 8. Tamper with the mandate: raise the weekly budget in the payload.
  const [mh, mp, ms] = token.split(".");
  const claims = JSON.parse(new TextDecoder().decode(base64url.decode(mp)));
  claims.mandate.weeklyBudgetCents = 100_000_000;
  const tampered = [mh, base64url.encode(JSON.stringify(claims)), ms].join(".");
  results.push({ name: "Raise the budget inside the mandate", reply: await base.as(tampered, DEMO_ORG.agentId).openRequest("more milk") });

  // 9. Sign a fresh mandate with a key the agent made up.
  const fake = await generateEd25519KeyPair(DEMO_ORG.kid);
  const selfSigned = await signMandate(demoMandate(new Date(), { weeklyBudgetCents: 100_000_000 }), fake);
  results.push({ name: "Sign its own mandate with a made-up key", reply: await base.as(selfSigned, DEMO_ORG.agentId).openRequest("more milk") });

  // 10. Use an expired mandate.
  const expired = await mandateToken({ validFrom: addDays(new Date(), -8).toISOString(), validUntil: addDays(new Date(), -1).toISOString() });
  results.push({ name: "Use last week's expired mandate", reply: await base.as(expired, DEMO_ORG.agentId).openRequest("more milk") });

  // 11. Another agent presents this agent's mandate.
  results.push({ name: "A different agent presents this mandate", reply: await base.as(token, "agent_someone_else").openRequest("more milk") });

  // 12. The agent tries to approve its own sign-off request: an order over what it may spend alone (a mandate with a
  // €50 limit, so it fits this week's remaining budget whatever ran before).
  const fifty = base.as(await mandateToken({ perOrderLimitCents: 5_000 }), DEMO_ORG.agentId);
  const bigQuote = await fifty.quote(requestId, [{ productId: roomy.id, quantity: roomyPacks(6_000) }]);
  if (bigQuote.status !== 201) throw new Error(`could not set up the sign-off attack: ${JSON.stringify(bigQuote.body.error)}`);
  const pending = await fifty.placeOrder(requestId, bigQuote.body.quoteToken, pick(bigQuote.body));
  if (!pending.body.order?.approval) throw new Error(`the sign-off attack needs a pending order: ${JSON.stringify(pending.body.error ?? pending.body.order?.status)}`);
  results.push({ name: "Approve its own order without the approver's link", reply: await agent.decide(pending.body.order.approval!.approvalId, "approve", "let-me-in") });

  // 13. Scrape the partner API.
  const many = [...new Set([...P.all, ...P.milk.map((x) => x.id)])];
  const scrape = many.length > 10 ? many : [...many, ...Array.from({ length: 11 - many.length }, (_, i) => `X-${i}`)];
  results.push({ name: `Ask live prices for ${scrape.length} products at once`, reply: await agent.availability(requestId, scrape) });

  for (const [i, { name, reply }] of results.entries()) {
    const e = reply.body.error;
    step(String(i + 1).padStart(2), name);
    say(`      -> HTTP ${reply.status}  refused by rule "${e?.rule ?? "-"}" (${e?.code ?? "no error?"})`);
    say(`         ${e?.message ?? JSON.stringify(reply.body).slice(0, 200)}`);
  }
  const refused = results.filter((r) => r.reply.status >= 400).length;
  say(`\n      ${refused} of ${results.length} attempts refused, each with a named rule.`);

  // Not a refusal but a guardrail: one need split into orders under the per-order limit goes to a person.
  // (A mandate with a €200 per-order limit, so the demo stays inside this week's remaining budget.)
  const tight = base.as(await mandateToken({ perOrderLimitCents: 20_000 }), DEMO_ORG.agentId);
  const half = roomyPacks(12_000);
  const splitReq = (await tight.openRequest("Milk for the weekend event", nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5]))).body.request.requestId;
  const first = await tight.quote(splitReq, [{ productId: roomy.id, quantity: half }]);
  const one = await tight.placeOrder(splitReq, first.body.quoteToken, pick(first.body));
  const second = await tight.quote(splitReq, [{ productId: roomy.id, quantity: half }]);
  const two = await tight.placeOrder(splitReq, second.body.quoteToken, pick(second.body));
  step("split", `One need, two orders of ${formatEur(half * roomyPrice)} under the €200 limit: the first ${one.body.order.status}, the second ${two.body.order.status}.`);
  indent(two.body.order.decision.rules.filter((r) => r.rule === "order_splitting" && r.outcome !== "pass").map((r) => `order_splitting (${r.outcome}): ${(r as { reason?: string }).reason ?? ""}`));

  const ledger = (await base.ledger()).body;
  const copy = structuredClone(ledger.entries) as LedgerEntry[];
  const victim = copy.findIndex((e) => e.type === "decision" && (e.data as { outcome: string }).outcome === "reject");
  (copy[victim].data as { outcome: string }).outcome = "auto_approve";
  const check = verifyLedger(copy);
  step("ledger", `Full chain verified: ${ledger.verification.ok} (${ledger.entries.length} entries).`);
  say(`      Someone edits entry #${copy[victim].seq} to say "auto_approve": ${check.ok ? "not detected?!" : `detected (${check.problem} at #${check.brokenAt})`}.`);
}

async function main() {
  const source = urlFlag >= 0 ? undefined : (await getRuntime()).catalogSource;
  say(`Dock scripted buyer: ${urlFlag >= 0 ? `against ${baseUrl}` : "in-process (no server)"}; catalogue: ${source ? (source.kind === "valio" ? `the partner's real catalogue (${source.products} products) with its live price/availability API` : "the 12-product seed (no index or no VALIO_API_KEY)") : "whatever the server runs"}`);
  if (which === "all" || which === "happy") await happyPath();
  if (which === "all" || which === "kitchen") await returningKitchen();
  if (which === "all" || which === "attacks") await attacks();
  const { catalog } = (await base.ledger()).body;
  say(`\nPartner API use for the whole run: ${catalog.liveCalls} live lookups by Dock, ${catalog.upstream ? `${catalog.upstream.httpRequests} HTTP requests to the partner (${catalog.upstream.cacheHits} answered from the cache)` : "none (seed catalogue)"}; ${catalog.searches} local master-data searches.`);
}

main()
  // Flush and close the Aiven adapters, if any are switched on (no-op in memory), so the process can exit.
  .then(() => shutdownAiven())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
