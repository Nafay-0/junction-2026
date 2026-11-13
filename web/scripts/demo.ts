/**
 * Scripted buyer agent. No LLM, no API keys: fixed logic playing Valio Aimo's example
 * "I need 1,000 litres of lactose-free milk by Monday", then a returning restaurant kitchen going through the
 * structured intake (mistake check, one question, option cards, "same as last time"), then a run of attempts
 * to make the agent misbehave.
 *
 *   pnpm demo                         all three runs, in-process (no server needed)
 *   pnpm demo happy | kitchen | attacks   one run
 *   pnpm demo --url http://localhost:3000   the same against a running `pnpm dev` (fills the page at /)
 */
import { base64url, compactVerify, importJWK, type CryptoKey } from "jose";
import { signMandate, type Mandate } from "@/core/mandate";
import { verifyLedger, type LedgerEntry } from "@/core/ledger";
import { addDays, formatEur, isoDate } from "@/core/util";
import { generateEd25519KeyPair } from "@/core/keys";
import { formatDay, localNow, nextDeliveryDay } from "@/core/kitchen";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { localFetch } from "@/server/local-transport";
import { DockClient, type Offer, type OptionCard, type Product, type Reply, type Step } from "./lib/client";

const args = process.argv.slice(2);
const urlFlag = args.indexOf("--url");
const baseUrl = urlFlag >= 0 ? args[urlFlag + 1] : "http://dock.local";
const which = args.find((a) => a === "happy" || a === "kitchen" || a === "attacks") ?? "all";
const base = new DockClient(urlFlag >= 0 ? (req) => fetch(req) : localFetch, baseUrl);

const say = (s = "") => console.log(s);
const step = (n: string, s: string) => say(`\n[${n}] ${s}`);
const indent = (lines: string[], pad = "      ") => lines.forEach((l) => say(pad + l));

function nextMonday(from: Date): string {
  const add = (8 - from.getUTCDay()) % 7 || 7;
  return isoDate(addDays(from, add));
}

async function mandateToken(overrides: Partial<Mandate> = {}): Promise<string> {
  return signMandate(demoMandate(new Date(), overrides), await demoOrgKeyPair());
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

  const neededBy = nextMonday(new Date());
  const req = await agent.openRequest("I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.", neededBy);
  const requestId = req.body.request.requestId;
  step("request", `Opened ${requestId}, need by ${neededBy}.`);

  const found = await agent.search(requestId, { q: "milk", category: "milk", attributes: ["lactose_free", "fat_1_5"] });
  const products = found.body.products;
  step("lookup", `Master data: ${products.length} lactose-free semi-skimmed milks. No live API call yet.`);
  indent(products.map((p) => `${p.id.padEnd(8)} ${p.name}  (on time ${Math.round(p.deliveryReliability * 100)} %, ${p.carbonKgPerUnit} kg CO2e/L)`));

  // Shortlist from master data only: reliable suppliers, big packs first for a 1,000 L order, then lower carbon.
  const shortlist = products
    .filter((p) => p.deliveryReliability >= 0.95)
    .sort((a, b) => b.packSize - a.packSize || a.carbonKgPerUnit - b.carbonKgPerUnit)
    .slice(0, 3);
  const live = await agent.availability(requestId, shortlist.map((p) => p.id));
  step("lookup", `Live price and availability for the shortlist only (${shortlist.length} of ${products.length} products):`);
  indent(live.body.offers.map((o) => `${o.productId.padEnd(8)} ${String(o.availablePacks).padStart(5)} packs  ${formatEur(o.unitPriceCents)}/pack  delivery ${o.deliveryDate}`));

  // Fill 1,000 L: cheapest per litre first, among offers that arrive in time.
  const byId = new Map(products.map((p) => [p.id, p] as [string, Product]));
  const perLitre = (o: Offer) => o.unitPriceCents / byId.get(o.productId)!.packSize;
  const usable = live.body.offers.filter((o) => o.deliveryDate <= neededBy).sort((a, b) => perLitre(a) - perLitre(b));
  let litresLeft = 1000;
  const lines: { productId: string; quantity: number; substituteFor?: string }[] = [];
  const first = usable[0].productId;
  for (const o of usable) {
    if (litresLeft <= 0) break;
    const pack = byId.get(o.productId)!.packSize;
    const packs = Math.min(o.availablePacks, Math.ceil(litresLeft / pack));
    if (packs <= 0) continue;
    lines.push({ productId: o.productId, quantity: packs, substituteFor: o.productId === first ? undefined : first });
    litresLeft -= packs * pack;
  }
  step("plan", `First choice ${first} has only ${usable[0].availablePacks * byId.get(first)!.packSize} L. Proposing:`);
  indent(lines.map((l) => `${l.quantity} x ${l.productId}${l.substituteFor ? `  (substitute for ${l.substituteFor})` : ""}`));

  const q = await agent.quote(requestId, lines);
  if (q.status !== 201) return void say(`Quote refused: ${JSON.stringify(q.body.error)}`);
  const { quote, quoteToken, policyPreview } = q.body;
  step("quote", `Wholesaler signed quote ${quote.quoteId}: ${formatEur(quote.totalCents)}, price fixed until ${quote.expiresAt.slice(11, 16)} UTC. Gate preview: ${policyPreview.outcome}.`);

  const placed = await agent.placeOrder(requestId, quoteToken, quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })));
  const order = placed.body.order;
  step("decision", `HTTP ${placed.status}: ${order.decision.outcome}`);
  indent(order.decision.reasons.map((r) => `- ${r}`));

  const msg = (await base.outbox()).body.messages.find((x) => x.orderId === order.orderId);
  if (!msg) return void say("No approval message found (is the server in production mode?).");
  step("approval", `Message to ${msg.approver.name}'s phone (not to the agent): ${baseUrl}${msg.link.replace(/token=.*/, "token=…")}`);
  const token = new URL(msg.link, baseUrl).searchParams.get("token")!;
  const decided = await base.decide(msg.approvalId, "approve", token, "OK, Arla is fine this week.");
  step("approval", `${msg.approver.name} approved. HTTP ${decided.status}: order ${decided.body.order.status}.`);

  const final = (await agent.getOrder(order.orderId)).body.order;
  const jwk = (await base.keys()).body.keys[0];
  const { payload } = await compactVerify(final.confirmation!, (await importJWK(jwk, "Ed25519")) as CryptoKey);
  const confirmation = JSON.parse(new TextDecoder().decode(payload));
  step("order", `Committed ${final.orderId}, ${formatEur(final.totalCents)}. Confirmation signature verified against the wholesaler's published key.`);
  indent(confirmation.lines.map((l: { quantity: number; productId: string; unitPriceCents: number; deliveryDate: string; substituteFor?: string }) =>
    `${l.quantity} x ${l.productId} at ${formatEur(l.unitPriceCents)}, delivery ${l.deliveryDate}${l.substituteFor ? `, substitutes ${l.substituteFor}` : ""}`,
  ));
  indent([`authorised by: ${confirmation.authorisedBy.name} (${confirmation.authorisedBy.role}); ledger head at commit: #${confirmation.ledgerHead.seq}`]);

  const ledger = (await base.ledger({ requestId })).body;
  step("ledger", `What the agent did and why (chain verified: ${ledger.verification.ok}):`);
  indent(ledger.explanation);
  say(`\n      Partner API use so far: ${ledger.catalog.liveCalls} live price/availability calls covering ${ledger.catalog.productsPriced} product prices; ${ledger.catalog.searches} local master-data searches.`);
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
  if (s.state === "options_ready") s.options.forEach(showCard);
  for (const n of s.notes) say(`      note: ${n}`);
}

function showCard(c: OptionCard): void {
  const co2 = c.co2.kg === null ? "no carbon data" : `${c.co2.kg} kg CO2e (product-group average)`;
  const rel = c.reliability === null ? "no reliability data" : `${Math.round(c.reliability * 100)} % delivered in full`;
  say(`      ${c.optionId}  ${c.labels.map((l) => l.replaceAll("_", " ")).join(" + ").toUpperCase()}`);
  say(`             ${c.lines.map((l) => `${l.packs} x ${l.productId}`).join(" + ")}  ${formatEur(c.totalCents)}  delivery ${formatDay(c.deliveryDate)}  ${co2}  ${rel}`);
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
async function settle(agent: DockClient, s: Step): Promise<Step> {
  if (s.state !== "needs_confirmation") return s;
  const responses = s.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id }));
  return (await agent.intakeConcerns(s.requestId, SANNA, responses)).body.step;
}

async function returningKitchen(): Promise<void> {
  say("\n" + "=".repeat(78));
  say(" RUN 2  A returning kitchen: mistake check, one question, options, same as last time");
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
    step(s.state, `${SANNA} taps "${tenfold.corrections[0].label}": the request is now ${s.need.quantity?.amount} ${s.need.quantity?.unit}. Next Dock would ask:`);
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

async function attacks(): Promise<void> {
  say("\n" + "=".repeat(78));
  say(" RUN 3  Trying to make the agent misbehave");
  say("=".repeat(78));
  const token = await mandateToken();
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

  // 0. A legitimate small order the agent may place alone.
  const smallQuote = await agent.quote(requestId, [{ productId: "VA-1001", quantity: 20 }]);
  const small = await agent.placeOrder(requestId, smallQuote.body.quoteToken, pick(smallQuote.body));
  step("ok", `Small order inside the mandate: HTTP ${small.status}, ${small.body.order.status} without anyone being asked (${small.body.order.decision.reasons[0]})`);

  // 1. Replay the quote that was just used.
  results.push({ name: "Reuse a quote that already bought something", reply: await agent.placeOrder(requestId, smallQuote.body.quoteToken, pick(smallQuote.body)) });

  // 2. Over the weekly budget (1,500 L in 1 L packs, €2,235).
  await tryOrder("Order €2,235 against a €2,000 weekly budget", [{ productId: "VA-1001", quantity: 1500 }]);

  // 3. Forbidden allergen: the oat drink contains gluten.
  await tryOrder("Buy an oat drink that contains gluten", [{ productId: "PK-4001", quantity: 50 }]);

  // 4. Not lactose-free.
  await tryOrder("Buy regular (not lactose-free) milk", [{ productId: "VA-1110", quantity: 10 }]);

  // 5. Substitute far above the price tolerance.
  await tryOrder("Substitute at +25.6 % per litre (tolerance 10 %)", [
    { productId: "VA-1010", quantity: 10 },
    { productId: "JP-3010", quantity: 100, substituteFor: "VA-1010" },
  ]);

  // 6. Change the price on the order.
  const q6 = await agent.quote(requestId, [{ productId: "VA-1002", quantity: 20 }]);
  results.push({ name: "Order at €0.01 instead of the quoted price", reply: await agent.placeOrder(requestId, q6.body.quoteToken, [{ productId: "VA-1002", quantity: 20, unitPriceCents: 1 }]) });

  // 7. Forge the quote itself.
  const [h, p, s] = q6.body.quoteToken.split(".");
  const body = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
  body.lines[0].unitPriceCents = 1;
  body.lines[0].lineTotalCents = 20;
  body.totalCents = 20;
  const forged = [h, base64url.encode(JSON.stringify(body)), s].join(".");
  results.push({ name: "Edit the price inside the signed quote", reply: await agent.placeOrder(requestId, forged, [{ productId: "VA-1002", quantity: 20, unitPriceCents: 1 }]) });

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

  // 12. The agent tries to approve its own sign-off request.
  const subQuote = await agent.quote(requestId, [
    { productId: "VA-1010", quantity: 10 },
    { productId: "AR-2010", quantity: 5, substituteFor: "VA-1010" },
  ]);
  const pending = await agent.placeOrder(requestId, subQuote.body.quoteToken, pick(subQuote.body));
  results.push({ name: "Approve its own order without the approver's link", reply: await agent.decide(pending.body.order.approval!.approvalId, "approve", "let-me-in") });

  // 13. Scrape the partner API.
  results.push({ name: "Ask live prices for every product at once", reply: await agent.availability(requestId, ["VA-1010", "AR-2010", "VA-1001", "VA-1002", "VA-1035", "JP-3010", "AR-2015", "VA-1201", "VA-1110", "PK-4001", "VA-2301"]) });

  for (const [i, { name, reply }] of results.entries()) {
    const e = reply.body.error;
    step(String(i + 1).padStart(2), name);
    say(`      -> HTTP ${reply.status}  refused by rule "${e?.rule ?? "-"}" (${e?.code ?? "no error?"})`);
    say(`         ${e?.message ?? JSON.stringify(reply.body).slice(0, 200)}`);
  }
  const refused = results.filter((r) => r.reply.status >= 400).length;
  say(`\n      ${refused} of ${results.length} attempts refused, each with a named rule.`);

  const ledger = (await base.ledger()).body;
  const copy = structuredClone(ledger.entries) as LedgerEntry[];
  const victim = copy.findIndex((e) => e.type === "decision" && (e.data as { outcome: string }).outcome === "reject");
  (copy[victim].data as { outcome: string }).outcome = "auto_approve";
  const check = verifyLedger(copy);
  step("ledger", `Full chain verified: ${ledger.verification.ok} (${ledger.entries.length} entries).`);
  say(`      Someone edits entry #${copy[victim].seq} to say "auto_approve": ${check.ok ? "not detected?!" : `detected (${check.problem} at #${check.brokenAt})`}.`);
}

async function main() {
  say(`Dock scripted buyer: ${urlFlag >= 0 ? `against ${baseUrl}` : "in-process (no server)"}`);
  if (which === "all" || which === "happy") await happyPath();
  if (which === "all" || which === "kitchen") await returningKitchen();
  if (which === "all" || which === "attacks") await attacks();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
