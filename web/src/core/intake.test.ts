import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { InMemoryKitchenRepository, type KitchenProfile } from "./kitchen";
import { NOW, P, STOCK, kitchen, regularHistory, statedPref } from "./kitchen-fixtures";
import { generateEd25519KeyPair } from "./keys";
import { Ledger, explain } from "./ledger";
import { createTrustRegistry, signMandate } from "./mandate";
import type { NeedInput } from "./need";
import { noOptionReason } from "./intake";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock } from "./orders";
import { sampleMandate } from "./test-fixtures";

let dock: Dock;
let session: AgentSession;
let ledger: Ledger;
let inner: InMemoryCatalog;
let kitchens: InMemoryKitchenRepository;

async function setup(profile: KitchenProfile | undefined) {
  const buyer = await generateEd25519KeyPair("laakso-key-1");
  ledger = new Ledger(undefined, () => NOW);
  inner = new InMemoryCatalog(Object.values(P), STOCK, () => NOW);
  kitchens = new InMemoryKitchenRepository(profile ? [profile] : []);
  dock = createDock({
    catalog: new MeteredCatalog(inner),
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
    wholesalerKey: await generateEd25519KeyPair("dock-wholesaler-1"),
    notifier: new InMemoryOutbox(),
    now: () => NOW,
    kitchens,
  });
  const mandate = sampleMandate(NOW, { requiredAttributes: [] }); // lactose-free comes from the kitchen's stated rule
  session = await dock.authenticate(await signMandate(mandate, buyer), mandate.agentId);
}

const lactoseRule = statedPref({ kind: "dimension", id: "pref_lf", dimension: "lactose", choice: "lactose_free", text: "Always lactose-free" } as never);
const returning = () => kitchen(regularHistory(), [lactoseRule]);
const need = (over: Partial<NeedInput> = {}): NeedInput => ({ item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: "2026-11-18", ...over });

beforeEach(() => setup(returning()));

describe("intake flow", () => {
  it("(a) catches 1,000 L where the kitchen takes 100, and records who corrected it", async () => {
    const first = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" } }) });
    expect(first.state).toBe("needs_confirmation");
    expect(first.concerns.map((c) => c.code)).toEqual(["quantity_tenfold"]);
    expect(dock.stats().liveCalls).toBe(0); // no live lookup before the buyer has answered
    // The example names the choices and pre-fills none of them: the answer is the buyer's.
    expect(first.next).toEqual({ method: "POST", path: `/api/v1/intake/${first.requestId}/concerns`, example: { by: "<the buyer's name>", responses: [{ key: "quantity_tenfold:1000:L", choice: "<the buyer's choice: confirm or use_100_L>" }] } });

    const fixed = await dock.intake.respondToConcerns(session, first.requestId, { by: "Aino Virtanen", responses: [{ key: first.concerns[0].key, choice: "use_100_L" }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(fixed.need.quantity).toEqual({ amount: 100, unit: "L" });
    expect(fixed.state).toBe("options_ready"); // memory answers the rest: nothing more to ask
    expect(fixed.acknowledgements).toMatchObject([{ action: "corrected", by: "Aino Virtanen", correctionId: "use_100_L", verified: true }]);
    const entry = ledger.entries({ requestId: first.requestId }).find((e) => e.data.step === "correction")!;
    expect(entry).toMatchObject({ type: "intake", actor: "buyer:Aino Virtanen", data: { by: "Aino Virtanen", relayedBy: session.agentId, channel: "portal_session", verified: true } });
    expect(entry.summary).toBe("Aino Virtanen corrected quantity_tenfold (in the kitchen's signed-in portal): Make it 100 L.");
  });

  it("a confirmation the agent only relays is not the person's: logged as relayed, and the order goes to a named person (F-HUMAN-INPUT-BY-AGENT)", async () => {
    const big = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" }, optimise: "price" }) });
    expect(big.concerns.map((c) => c.code)).toEqual(["quantity_tenfold"]);
    const relayed = await dock.intake.respondToConcerns(session, big.requestId, { by: "Sanna Koskinen (head chef)", responses: [{ key: big.concerns[0].key, choice: "confirm" }] });
    const entry = ledger.entries({ requestId: big.requestId }).find((e) => e.data.step === "confirmation")!;
    expect(entry.actor).toBe(`agent:${session.agentId}`);
    expect(entry.summary).not.toMatch(/confirmed as intended/);
    expect(entry.summary).toMatch(/^Relayed by the agent, not verified/);
    expect(relayed.acknowledgements[0]).toMatchObject({ verified: false, channel: "relayed" });
    expect(relayed.signOffNotes.join(" ")).toMatch(/Not verified: the agent relayed that Sanna Koskinen \(head chef\) confirmed/);
    // The cheapest card is within the agent's own limit, yet the order may not be decided by the agent alone.
    const q = relayed.quote!;
    expect(q.policyPreview.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("escalate");
    const order = await dock.placeOrder(session, { requestId: big.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    expect(order.status).toBe("pending_approval");
    expect(order.notes?.join(" ")).toMatch(/Not verified/);

    // The same confirmation from the kitchen's signed-in portal is the person's own: no extra sign-off.
    const again = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" }, optimise: "price", deliverBy: "2026-11-19" }) });
    const own = await dock.intake.respondToConcerns(session, again.requestId, { by: "ignored", responses: [{ key: again.concerns[0].key, choice: "confirm" }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(own.quote!.policyPreview.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("pass");
    expect(ledger.entries({ requestId: again.requestId }).find((e) => e.data.step === "confirmation")).toMatchObject({ actor: "buyer:Aino Virtanen", summary: expect.stringMatching(/^Aino Virtanen confirmed as intended, in the kitchen's signed-in portal/) });
  });

  it("a relayed 'remember this' applies to the request only: it never becomes a kitchen rule", async () => {
    const asked = await dock.intake.open(session, { need: need() });
    const before = (await kitchens.getProfile("org_laakso"))!.stated.length;
    const r = await dock.intake.answer(session, asked.requestId, { by: "Aino", answers: [{ questionId: "optimise", optionId: "co2", remember: true }] });
    expect((await kitchens.getProfile("org_laakso"))!.stated.length).toBe(before);
    expect(r.notes.join(" ")).toMatch(/not stored as a kitchen rule/);
  });

  it("lets the buyer confirm a warning as intended, but not an error", async () => {
    const big = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" }, optimise: "price" }) });
    const ok = await dock.intake.respondToConcerns(session, big.requestId, { by: "Aino", responses: [{ key: big.concerns[0].key, choice: "confirm" }] });
    // The request said "price" and the cheapest option meets all of it, so the agent takes it without asking again.
    expect(ok.state).toBe("quoted");
    expect(ok.chosen).toMatchObject({ optionId: "opt_1", by: `agent ${session.agentId}` });
    expect(ok.quote!.quote.lines.map((l) => [l.productId, l.quantity, l.substituteFor?.productId])).toEqual([["T-BOX", 60, undefined], ["U-BOX", 40, "T-BOX"]]);
    expect(ledger.entries({ requestId: big.requestId }).some((e) => e.data.step === "confirmation" && e.data.by === "Aino")).toBe(true);

    const past = await dock.intake.open(session, { need: need({ deliverBy: "2026-11-02" }) });
    expect(past.concerns[0]).toMatchObject({ code: "delivery_in_past", confirmable: false });
    await expect(dock.intake.respondToConcerns(session, past.requestId, { by: "Aino", responses: [{ key: past.concerns[0].key, choice: "confirm" }] })).rejects.toMatchObject({ status: 409, code: "concern_not_confirmable" });
    await expect(dock.intake.respondToConcerns(session, past.requestId, { by: "Aino", responses: [{ key: "nope", choice: "confirm" }] })).rejects.toMatchObject({ code: "concern_not_open" });
  });

  it("updates the request's need-by date when a date is corrected, so the gate checks the new date", async () => {
    const sat = await dock.intake.open(session, { need: need({ deliverBy: "2026-11-21" }) });
    const fixed = await dock.intake.respondToConcerns(session, sat.requestId, { by: "Aino", responses: [{ key: sat.concerns[0].key, choice: "deliver_2026-11-20" }] });
    expect(fixed.need.deliverBy).toBe("2026-11-20");
    expect(ledger.entries({ requestId: sat.requestId })[0].data.neededBy).toBe("2026-11-21");
    expect(fixed.state).toBe("options_ready");
    const quoted = await dock.intake.choose(session, sat.requestId, { by: "Aino", optionId: fixed.options[0].optionId });
    expect(quoted.quote!.policyPreview.rules.find((r) => r.rule === "delivery_deadline")!.reason).toBe("Every line arrives by 2026-11-20.");
  });

  it("(b) asks nothing memory answers, ranks three options with pros and cons, and quotes the chosen one", async () => {
    const shown = await dock.intake.open(session, { need: need() });
    expect(shown.state).toBe("options_ready");
    expect(shown.questions).toEqual([]);
    expect(shown.fromMemory.map((m) => [m.question.id, m.source])).toEqual([["dim:fat", "learned"]]);
    expect(shown.options.map((o) => [o.rank, o.match, o.labels])).toEqual([
      ["best", "full", ["best_price", "lowest_carbon"]],
      ["better", "full", ["same_as_last_time"]],
      ["good", "full", ["most_reliable"]],
    ]);
    expect(shown.preselected).toBeUndefined(); // no goal given: the cards are the question
    expect(shown.options.every((o) => o.pros.length + o.cons.length > 0)).toBe(true);
    expect(dock.stats().liveCalls).toBe(1);

    const reliable = shown.options.find((o) => o.labels.includes("most_reliable"))!;
    const quoted = await dock.intake.choose(session, shown.requestId, { by: "Aino", optionId: reliable.optionId });
    expect(quoted.state).toBe("quoted");
    expect(quoted.quote!.quote.lines.map((l) => [l.productId, l.quantity])).toEqual([["T-1L", 100]]);
    expect(quoted.next.path).toBe("/api/v1/orders");

    const order = await dock.placeOrder(session, quoted.next.example as never);
    expect(order.status).toBe("committed");
    const profile = (await kitchens.getProfile("org_laakso"))!;
    expect(profile.history.at(-1)).toMatchObject({ orderId: order.orderId, family: "milk", amount: 100, unit: "L", neededBy: "2026-11-18", chosenLabels: ["most_reliable"] });

    const story = explain(ledger.entries({ requestId: shown.requestId })).join("\n");
    for (const s of ["Structured need", "Dock offered 3 options", `chose ${reliable.optionId}`, "Wholesaler quoted", "Gate decision", "Committed"]) expect(story).toContain(s);
  });

  it("remembers an answer when told to, and does not ask it again", async () => {
    const asked = await dock.intake.open(session, { need: need() });
    const answered = await dock.intake.answer(session, asked.requestId, { by: "Aino Virtanen", answers: [{ questionId: "optimise", optionId: "co2", remember: true }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(answered.state).toBe("quoted"); // the answer decides it: lowest carbon, a full match
    expect(answered.chosen?.labels).toContain("lowest_carbon");
    expect((await kitchens.getProfile("org_laakso"))!.stated.at(-1)).toMatchObject({ kind: "optimise", goal: "co2", statedBy: "Aino Virtanen", family: "milk" });
    const again = await dock.intake.open(session, { need: need({ deliverBy: "2026-11-19" }) });
    expect(again.state).toBe("quoted");
    expect(again.fromMemory.find((m) => m.question.id === "optimise")).toMatchObject({ source: "stated", optionId: "co2" });
    expect(again.preselected).toMatchObject({ source: "stated" });
    expect(again.chosen?.labels).toContain("lowest_carbon");
  });

  it("lets the buyer override a learned pre-selection by answering its question", async () => {
    const asked = await dock.intake.open(session, { need: need() });
    expect(asked.state).toBe("options_ready");
    const changed = await dock.intake.answer(session, asked.requestId, { by: "Aino", answers: [{ questionId: "dim:fat", optionId: "fat_free" }] });
    expect(changed.options.flatMap((o) => o.lines.map((l) => l.productId))).toEqual(["T-SKIM"]);
  });

  it("(c) repeats the last order in one call", async () => {
    const quoted = await dock.intake.open(session, { need: { item: { text: "milk", category: "milk" }, sameAsLastTime: true, deliverBy: "2026-11-18" } });
    expect(quoted.state).toBe("quoted");
    expect(quoted.quote!.quote.lines.map((l) => [l.productId, l.quantity])).toEqual([["U-BOX", 10]]);
    expect(quoted.chosen).toMatchObject({ labels: ["same_as_last_time"] });
  });

  it("falls back to options when the last product cannot fill the order", async () => {
    inner.setStock("U-BOX", { availablePacks: 0 });
    const r = await dock.intake.open(session, { need: { item: { text: "milk", category: "milk" }, sameAsLastTime: true, optimise: "price" } });
    expect(r.state).toBe("options_ready"); // not chosen alone: every option gives up the product asked for
    expect(r.notes).toContain("Same as last time (Other lactose-free milk 1.5 %, 10 L box) is not possible: out of stock.");
    expect(r.options.every((o) => o.match === "compromise" && o.givesUp.some((g) => g.part === "product"))).toBe(true);
  });

  it("refuses 'same as last time' with nothing to repeat and no amount", async () => {
    await setup(undefined);
    await expect(dock.intake.open(session, { need: { item: { text: "milk", category: "milk" }, sameAsLastTime: true } })).rejects.toMatchObject({ status: 422, code: "nothing_to_repeat" });
  });

  it("a first-time kitchen gets the large-order check and the questions memory cannot answer", async () => {
    await setup(undefined);
    // A first order has nothing to compare with: its size is a note on every card and for the approver, not a stop.
    const big = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" }, item: { text: "milk", category: "milk", attributes: ["lactose_free", "fat_1_5"] } }) });
    expect(big.state).toBe("options_ready");
    expect(big.concerns).toEqual([]);
    expect(big.options.every((o) => o.cons.some((c) => /first order .* 1,000 L is a large one/.test(c)))).toBe(true);
    expect(big.signOffNotes).toEqual([expect.stringMatching(/^Check the amount: This is the first order/)]);
    // Nothing said about lactose or fat: not asked; the cards span them and the buyer chooses one.
    const small = await dock.intake.open(session, { need: need() });
    expect(small.state).toBe("options_ready");
    expect(small.questions).toEqual([]);
    expect(small.openChoices.map((q) => q.id)).toEqual(["dim:fat", "dim:lactose"]);
    expect(new Set(small.options.map((o) => o.lines[0].productId)).size).toBe(small.options.length);
    expect(small.fromMemory).toEqual([]);
    // Saying "price" does not let the agent pick a fat content the buyer never chose: the cards still differ on it.
    const priced = await dock.intake.open(session, { need: need({ optimise: "price", deliverBy: "2026-11-19" }) });
    expect(priced.state).toBe("options_ready");
    expect(priced.preselected?.source).toBe("request");
  });

  it("cancels a duplicate on one tap", async () => {
    const first = await dock.intake.open(session, { need: need({ optimise: "price" }) });
    expect(first.state).toBe("quoted");
    await dock.placeOrder(session, first.next.example as never);
    const dup = await dock.intake.open(session, { need: need({ optimise: "price" }) });
    expect(dup.concerns.map((c) => c.code)).toEqual(["duplicate_recent"]);
    const cancelled = await dock.intake.respondToConcerns(session, dup.requestId, { by: "Aino", responses: [{ key: dup.concerns[0].key, choice: "cancel" }] });
    expect(cancelled.state).toBe("cancelled");
    await expect(dock.intake.choose(session, dup.requestId, { by: "Aino", optionId: "opt_1" })).rejects.toMatchObject({ status: 409, code: "intake_wrong_state" });
  });

  it("sets a stated rule aside only for this request when the buyer confirms 'just this once'", async () => {
    const r = await dock.intake.open(session, { need: need({ item: { text: "ordinary milk", category: "milk", excludedAttributes: ["lactose_free"] }, optimise: "price" }) });
    expect(r.concerns.map((c) => c.code)).toEqual(["contradicts_preference"]);
    const once = await dock.intake.respondToConcerns(session, r.requestId, { by: "Aino", responses: [{ key: r.concerns[0].key, choice: "confirm" }] });
    expect(once.options.flatMap((o) => o.lines.map((l) => l.productId))).toEqual(["T-REG"]);
    const next = await dock.intake.open(session, { need: need({ optimise: "price", deliverBy: "2026-11-19" }) });
    expect(next.options.flatMap((o) => o.lines.map((l) => l.productId))).not.toContain("T-REG");
  });

  it("reports no options with the reasons when nothing fits", async () => {
    const r = await dock.intake.open(session, { need: need({ item: { text: "milk", category: "milk", attributes: ["vegan"] }, optimise: "price" }) });
    expect(r.state).toBe("no_options");
    expect(r.excluded.length).toBeGreaterThan(0);
  });

  it("names the weekly budget as the blocker when it removed the options (F-NO-OPTION-REASON)", () => {
    const excluded = [
      { productId: "A", reason: "earliest delivery Thu 19 Nov is after Wed 18 Nov, the latest the mandate allows", code: "too_late" as const },
      { productId: "B", reason: "only 400 L in stock, and no substitute within the mandate covers the rest", code: "no_substitute" as const },
      { productId: "C", reason: "€1,322.00 would go over the weekly budget", code: "over_budget" as const },
      { productId: "D", reason: "€1,400.00 would go over the weekly budget", code: "over_budget" as const },
    ];
    const text = noOptionReason(excluded, "2026-11-16", { mandate: { weeklyBudgetCents: 200_000 }, spentCents: 132_200, heldCents: 0, held: [] });
    expect(text).toMatch(/^Nothing fits\. The blocker is the weekly budget: 2 options that fit would cost more than the €678\.00 left of €2,000\.00 this week \(€1,322\.00 already committed\)/);
    expect(text).toContain("A: earliest delivery");
    expect(noOptionReason([{ productId: "A", reason: "x", code: "cutoff_passed" }], "2026-11-16")).toMatch(/^Nothing fits\. The blocker is the order cut-off has passed for A/);
    // With names, a person reads the product, not only its code.
    expect(noOptionReason([{ productId: "A", reason: "x", code: "cutoff_passed" }, { productId: "B", reason: "no valid price right now", code: "no_offer" }], "2026-11-16", undefined, { A: "Milk 10 l", B: "Oat drink 1 l" })).toMatch(
      /order cut-off has passed for Milk 10 l \(A\).*Oat drink 1 l \(B\): no valid price/,
    );
  });

  it("keeps intakes private to the agent and validates input", async () => {
    const r = await dock.intake.open(session, { need: need() });
    await expect(dock.intake.get({ ...session, agentId: "someone_else" }, r.requestId)).rejects.toMatchObject({ status: 404 });
    await expect(dock.intake.open(session, { need: { item: { text: "milk" } } })).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(dock.intake.answer(session, r.requestId, { by: "Aino", answers: [{ questionId: "optimise", optionId: "cheapest!" }] })).rejects.toMatchObject({ code: "option_unknown" });
    await expect(dock.intake.open(session, { need: need({ item: { text: "unobtainium" } }) })).rejects.toMatchObject({ code: "family_unknown" });
  });

  it("shows the kitchen's memory", async () => {
    const k = await dock.intake.kitchen(session);
    expect(k.families[0]).toMatchObject({ family: "milk", orders: 10 });
    expect(k.stated.map((p) => p.text)).toEqual(["Always lactose-free"]);
  });
});

describe("deliver on an exact day (not merely by it)", () => {
  it("delivers every option on the day asked, quotes that day, and the gate holds the order to it", async () => {
    const day = "2026-11-18"; // a few days out: the seed could deliver sooner
    let step = await dock.intake.open(session, { need: need({ deliverBy: undefined, deliverOn: day, optimise: "price" }) });
    expect(step.need).toMatchObject({ deliverOn: day, deliverBy: day });
    if (step.state === "options_ready") step = await dock.intake.choose(session, step.requestId, { by: "Sanna", optionId: step.options[0].optionId });
    expect(step.state).toBe("quoted");
    expect(step.quote!.quote.lines.every((l) => l.deliveryDate === day)).toBe(true);
    expect(step.quote!.policyPreview.rules.find((r) => r.rule === "delivery_deadline")).toMatchObject({ outcome: "pass", reason: `Every line arrives on ${day}, the day asked.` });
    const order = await dock.placeOrder(session, { requestId: step.requestId });
    expect(order.lines.every((l) => l.deliveryDate === day)).toBe(true);
  });

  it("without deliverOn nothing changes: the earliest day the wholesaler can", async () => {
    const step = await dock.intake.open(session, { need: need({ optimise: "price" }) });
    const lines = step.quote?.quote.lines ?? step.options[0].lines;
    expect(lines.every((l) => l.deliveryDate < "2026-11-18")).toBe(true);
  });
});
