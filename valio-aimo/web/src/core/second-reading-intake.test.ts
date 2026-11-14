import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutbox } from "./approval";
import { InMemoryCatalog, MeteredCatalog } from "./catalog";
import { InMemoryKitchenRepository } from "./kitchen";
import { NOW, P, STOCK, kitchen, regularHistory, statedPref } from "./kitchen-fixtures";
import { generateEd25519KeyPair } from "./keys";
import { Ledger } from "./ledger";
import { createTrustRegistry, signMandate } from "./mandate";
import type { NeedInput } from "./need";
import { InMemoryDockRepository, createDock, type AgentSession, type Dock } from "./orders";
import { compareReadings, fieldValues, type Reading, type SecondReadingRecord } from "./second-reading";
import { sampleMandate } from "./test-fixtures";

/**
 * The second reading inside the intake: a record the interpreter left for these words adds one question before any
 * price lookup when the readings differ, and nothing when they agree or the second reader was unavailable.
 */
let dock: Dock;
let session: AgentSession;
let ledger: Ledger;
const readings = new Map<string, SecondReadingRecord>();

const TEXT = "100 litres of milk for Wednesday";
const need = (over: Partial<NeedInput> = {}): NeedInput => ({ text: TEXT, item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: "2026-11-18", ...over });
const asReading = (n: NeedInput): Reading => ({ item: { text: n.item.text, attributes: n.item.attributes ?? [], excludedAttributes: n.item.excludedAttributes ?? [] }, quantity: n.quantity, deliverBy: n.deliverBy, requiredClaims: n.requiredClaims ?? [], forbiddenAllergens: n.forbiddenAllergens ?? [], sameAsLastTime: !!n.sameAsLastTime });
function remember(first: NeedInput, second: Partial<Reading>, status?: "unavailable") {
  const a = asReading(first);
  const c = compareReadings(a, { ...a, ...second }, { text: first.text });
  readings.set(first.text!, { status: status ?? (c.agreed ? "agreed" : "differed"), firstModel: "anthropic:claude-opus-5-5", secondModel: "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16", secondMs: 1400, waitedMs: 0, differences: status ? [] : c.differences, minor: c.minor, firstValues: fieldValues(a), at: NOW.toISOString(), ...(status ? { reason: "timeout" as const } : {}) });
}

beforeEach(async () => {
  readings.clear();
  const buyer = await generateEd25519KeyPair("laakso-key-1");
  ledger = new Ledger(undefined, () => NOW);
  const lactoseRule = statedPref({ kind: "dimension", id: "pref_lf", dimension: "lactose", choice: "lactose_free", text: "Always lactose-free" } as never);
  dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(Object.values(P), STOCK, () => NOW)),
    repo: new InMemoryDockRepository(),
    ledger,
    trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
    wholesalerKey: await generateEd25519KeyPair("dock-wholesaler-1"),
    notifier: new InMemoryOutbox(),
    now: () => NOW,
    kitchens: new InMemoryKitchenRepository([kitchen(regularHistory(), [lactoseRule])]),
    secondReadings: (orgId, text) => (orgId === "org_laakso" && text ? readings.get(text) : undefined),
  });
  const mandate = sampleMandate(NOW, { requiredAttributes: [] });
  session = await dock.authenticate(await signMandate(mandate, buyer), mandate.agentId);
});

describe("the second reading in the intake", () => {
  it("agreed: nothing is asked, and the ledger says the words were read twice and by whom", async () => {
    remember(need(), {});
    const step = await dock.intake.open(session, { need: need() });
    expect(step.state).toBe("options_ready");
    expect(step.concerns).toEqual([]);
    expect(step.secondReading).toMatchObject({ status: "agreed", readers: { first: "Claude Opus 5.5", second: "NVIDIA Nemotron 3 Nano" } });
    const entry = ledger.entries({ requestId: step.requestId }).find((e) => e.data.step === "second_reading")!;
    expect(entry).toMatchObject({ actor: "dock", data: { status: "agreed", firstModel: "anthropic:claude-opus-5-5", secondModel: "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16" } });
  });

  it("differed: one question about exactly that field, before any live price lookup", async () => {
    remember(need(), { quantity: { amount: 1000, unit: "L" } });
    const step = await dock.intake.open(session, { need: need() });
    expect(step.state).toBe("needs_confirmation");
    expect(step.concerns).toHaveLength(1);
    expect(step.concerns[0]).toMatchObject({ code: "readings_differ", evidence: { field: "amount", first: "100 L", second: "1,000 L" } });
    expect(step.concerns[0].corrections.map((c) => c.id)).toEqual(["keep_first", "use_second", "rewrite"]);
    expect(dock.stats().liveCalls).toBe(0);
  });

  it("the buyer keeps the first reading: the request goes on as read, and the question is not asked again", async () => {
    remember(need(), { quantity: { amount: 1000, unit: "L" } });
    const step = await dock.intake.open(session, { need: need() });
    const next = await dock.intake.respondToConcerns(session, step.requestId, { by: "Aino Virtanen", responses: [{ key: step.concerns[0].key, choice: "keep_first" }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(next.state).toBe("options_ready");
    expect(next.need.quantity).toEqual({ amount: 100, unit: "L" });
  });

  it("the buyer takes the second reading: the need changes, and the usual checks run on it (1,000 L where the kitchen takes 100)", async () => {
    remember(need(), { quantity: { amount: 1000, unit: "L" } });
    const step = await dock.intake.open(session, { need: need() });
    const next = await dock.intake.respondToConcerns(session, step.requestId, { by: "Aino Virtanen", responses: [{ key: step.concerns[0].key, choice: "use_second" }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(next.need.quantity).toEqual({ amount: 1000, unit: "L" });
    expect(next.concerns.map((c) => c.code)).toEqual(["quantity_tenfold"]);
  });

  it("neither: the request is cancelled so the buyer can write it again", async () => {
    remember(need(), { deliverBy: "2026-11-25" });
    const step = await dock.intake.open(session, { need: need() });
    expect(step.concerns[0]).toMatchObject({ evidence: { field: "date" } });
    const next = await dock.intake.respondToConcerns(session, step.requestId, { by: "Aino Virtanen", responses: [{ key: step.concerns[0].key, choice: "rewrite" }] }, { channel: "portal_session", person: "Aino Virtanen" });
    expect(next.state).toBe("cancelled");
  });

  it("unavailable, or no record for these words (another door, another process): read once, nothing asked", async () => {
    remember(need(), { quantity: { amount: 1000, unit: "L" } }, "unavailable");
    const step = await dock.intake.open(session, { need: need() });
    expect(step.state).toBe("options_ready");
    expect(step.secondReading).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(ledger.entries({ requestId: step.requestId }).find((e) => e.data.step === "second_reading")!.summary).toMatch(/^Read once: the second reader \(NVIDIA Nemotron 3 Nano\) was unavailable/);
    const other = await dock.intake.open(session, { need: need({ text: "something else entirely, 100 L milk" }) });
    expect(other.secondReading).toBeUndefined();
  });

  it("a need already changed on that field before the intake (the buyer edited it) is not asked about", async () => {
    remember(need(), { quantity: { amount: 1000, unit: "L" } });
    const step = await dock.intake.open(session, { need: need({ quantity: { amount: 120, unit: "L" } }) });
    expect(step.concerns.filter((c) => c.code === "readings_differ")).toEqual([]);
  });
});
