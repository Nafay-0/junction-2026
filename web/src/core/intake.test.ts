import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { InMemoryKitchenRepository, type KitchenProfile } from "./kitchen";
import { NOW, P, STOCK, kitchen, regularHistory, statedPref } from "./kitchen-fixtures";
import { generateEd25519KeyPair } from "./keys";
import { Ledger, explain } from "./ledger";
import { createTrustRegistry, signMandate } from "./mandate";
import type { NeedInput } from "./need";
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
    expect(first.next).toEqual({ method: "POST", path: `/api/v1/intake/${first.requestId}/concerns`, example: { by: "<person>", responses: [{ key: "quantity_tenfold:1000:L", choice: "use_100_L" }] } });

    const fixed = await dock.intake.respondToConcerns(session, first.requestId, { by: "Aino Virtanen", responses: [{ key: first.concerns[0].key, choice: "use_100_L" }] });
    expect(fixed.need.quantity).toEqual({ amount: 100, unit: "L" });
    expect(fixed.state).toBe("needs_input");
    expect(fixed.acknowledgements).toMatchObject([{ action: "corrected", by: "Aino Virtanen", correctionId: "use_100_L" }]);
    const entry = ledger.entries({ requestId: first.requestId }).find((e) => e.data.step === "correction")!;
    expect(entry).toMatchObject({ type: "intake", actor: "buyer:Aino Virtanen", data: { by: "Aino Virtanen", relayedBy: session.agentId } });
    expect(entry.summary).toBe("Aino Virtanen corrected quantity_tenfold: Make it 100 L.");
  });

  it("lets the buyer confirm a warning as intended, but not an error", async () => {
    const big = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" }, optimise: "price" }) });
    const ok = await dock.intake.respondToConcerns(session, big.requestId, { by: "Aino", responses: [{ key: big.concerns[0].key, choice: "confirm" }] });
    expect(ok.state).toBe("options_ready");
    expect(ok.options[0].quoteLines).toEqual([{ productId: "T-BOX", quantity: 60 }, { productId: "U-BOX", quantity: 40, substituteFor: "T-BOX" }]);
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
    const answered = await dock.intake.answer(session, sat.requestId, { by: "Aino", answers: [{ questionId: "optimise", optionId: "price" }] });
    const quoted = await dock.intake.choose(session, sat.requestId, { by: "Aino", optionId: answered.options[0].optionId });
    expect(quoted.quote!.policyPreview.rules.find((r) => r.rule === "delivery_deadline")!.reason).toBe("Every line arrives by 2026-11-20.");
  });

  it("(b) asks one question, shows three options with pros and cons, and quotes the chosen one", async () => {
    const asked = await dock.intake.open(session, { need: need() });
    expect(asked.state).toBe("needs_input");
    expect(asked.questions.map((q) => q.id)).toEqual(["optimise"]);
    expect(asked.fromMemory.map((m) => [m.question.id, m.source])).toEqual([
      ["dim:fat", "learned"],
      ["dim:organic", "learned"],
    ]);

    const shown = await dock.intake.answer(session, asked.requestId, { by: "Aino", answers: [{ questionId: "optimise", optionId: "no_preference" }] });
    expect(shown.state).toBe("options_ready");
    expect(shown.options.map((o) => o.labels)).toEqual([["best_price", "lowest_carbon"], ["most_reliable"], ["same_as_last_time"]]);
    expect(shown.preselected).toBeUndefined();
    expect(shown.options.every((o) => o.pros.length + o.cons.length > 0)).toBe(true);
    expect(dock.stats().liveCalls).toBe(1);

    const quoted = await dock.intake.choose(session, asked.requestId, { by: "Aino", optionId: "opt_2" });
    expect(quoted.state).toBe("quoted");
    expect(quoted.quote!.quote.lines.map((l) => [l.productId, l.quantity])).toEqual([["T-1L", 100]]);
    expect(quoted.next.path).toBe("/api/v1/orders");

    const order = await dock.placeOrder(session, quoted.next.example as never);
    expect(order.status).toBe("committed");
    const profile = (await kitchens.getProfile("org_laakso"))!;
    expect(profile.history.at(-1)).toMatchObject({ orderId: order.orderId, family: "milk", amount: 100, unit: "L", neededBy: "2026-11-18", chosenLabels: ["most_reliable"] });

    const story = explain(ledger.entries({ requestId: asked.requestId })).join("\n");
    for (const s of ["Structured need", "Dock asked 1 question", "answered", "Dock offered 3 options", "chose opt_2", "Wholesaler quoted", "Gate decision", "Committed"]) expect(story).toContain(s);
  });

  it("remembers an answer when told to, and does not ask it again", async () => {
    const asked = await dock.intake.open(session, { need: need() });
    await dock.intake.answer(session, asked.requestId, { by: "Aino Virtanen", answers: [{ questionId: "optimise", optionId: "co2", remember: true }] });
    expect((await kitchens.getProfile("org_laakso"))!.stated.at(-1)).toMatchObject({ kind: "optimise", goal: "co2", statedBy: "Aino Virtanen", family: "milk" });
    const again = await dock.intake.open(session, { need: need({ deliverBy: "2026-11-19" }) });
    expect(again.state).toBe("options_ready");
    expect(again.fromMemory.find((m) => m.question.id === "optimise")).toMatchObject({ source: "stated", optionId: "co2" });
    expect(again.preselected).toMatchObject({ source: "stated", optionId: again.options.find((o) => o.labels.includes("lowest_carbon"))!.optionId });
  });

  it("lets the buyer override a learned pre-selection by answering its question", async () => {
    const asked = await dock.intake.open(session, { need: need({ optimise: "price" }) });
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
    expect(r.state).toBe("options_ready");
    expect(r.notes[0]).toBe("Same as last time is not possible: out of stock. Here are the options instead.");
  });

  it("refuses 'same as last time' with nothing to repeat and no amount", async () => {
    await setup(undefined);
    await expect(dock.intake.open(session, { need: { item: { text: "milk", category: "milk" }, sameAsLastTime: true } })).rejects.toMatchObject({ status: 422, code: "nothing_to_repeat" });
  });

  it("a first-time kitchen gets the large-order check and the questions memory cannot answer", async () => {
    await setup(undefined);
    const big = await dock.intake.open(session, { need: need({ quantity: { amount: 1000, unit: "L" } }) });
    expect(big.concerns.map((c) => c.code)).toEqual(["large_first_order"]);
    const small = await dock.intake.open(session, { need: need() });
    expect(small.questions.map((q) => q.id)).toEqual(["dim:fat", "dim:lactose"]);
    expect(small.fromMemory).toEqual([]);
  });

  it("cancels a duplicate on one tap", async () => {
    const first = await dock.intake.open(session, { need: need({ optimise: "price" }) });
    const q = await dock.intake.choose(session, first.requestId, { by: "Aino", optionId: "opt_1" });
    await dock.placeOrder(session, q.next.example as never);
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
