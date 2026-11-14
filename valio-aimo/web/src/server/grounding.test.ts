import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DOES_NOT_SAY } from "@/core/grounding";
import { askAssistant, type AssistantRecord } from "./agent/assistant";
import { groundInterpretation } from "./agent/interpret-grounding";
import { interpretNeed, type LlmNeed } from "./agent/interpret";
import { scriptedModel } from "./agent/testing";
import { toRunMessages } from "./aiven/showcase/launcher";
import { CallRegistry, voiceLimits } from "./channels/voice/calls";
import { groundingStats, recordGrounding, resetGroundingStats } from "./grounding";
import { groundProposals } from "./memory/grounding";
import { toCandidate, type LlmCandidate } from "./memory/propose";

/**
 * One test per surface where model text reaches a person: what no data backs is replaced (or removed) before it is
 * shown, and the operations portal's counter (server/grounding.ts) counts it.
 */
beforeEach(() => resetGroundingStats());
const fired = (s: keyof ReturnType<typeof groundingStats>["surfaces"]) => groundingStats().surfaces[s];

const oat: AssistantRecord = {
  id: "product:460110",
  kind: "product",
  label: "Oddlygood Barista oat drink 1 l",
  data: { code: "460110", brand: "Oddlygood", dietaryClaims: ["lactose_free", "vegan"], allergens: { contains: ["oats", "gluten"], mayContain: ["nuts"], statedFreeFrom: ["milk", "eggs"] } },
};

describe("assistant panel", () => {
  it("replaces a sentence that claims what no record says, keeps the rest, marks data missing and counts it", async () => {
    const answer = { kind: "answer", answer: "Oddlygood Barista is lactose-free and vegan. It is also nut-free, so it is safe for the school. Try Oatly too.", citations: ["product:460110"], dataMissing: false };
    const r = await askAssistant({ question: "Is this nut-free?", records: [oat], brands: ["Oddlygood", "Oatly"], model: { ...scriptedModel([{ text: JSON.stringify(answer) }]), id: "scripted" } });
    expect(r.answer).toBe(`Oddlygood Barista is lactose-free and vegan. ${DATA_DOES_NOT_SAY}`);
    expect(r.dataMissing).toBe(true);
    expect(fired("assistant")).toMatchObject({ checked: 1, fired: 1 });
  });
});

describe("voice agent", () => {
  it("counts the call screen's checks with each heartbeat and its cuts one by one", () => {
    const reg = new CallRegistry();
    const c = reg.open("kaari", "hands_free", voiceLimits({}));
    reg.heartbeat(c.callId, "kaari", { grounding: { checked: 4, dropped: 0 } });
    reg.heartbeat(c.callId, "kaari", { grounding: { checked: 7, dropped: 1 } });
    recordGrounding("voice", [{ kind: "price", said: "1,250.00" }], `call ${c.callId}`, false); // what POST .../call/{id} {op:"dropped"} does
    expect(fired("voice")).toEqual({ checked: 7, fired: 1, removed: 1 });
  });
});

describe("interpreter", () => {
  const raw = (over: Partial<LlmNeed>): LlmNeed => ({
    isPurchaseRequest: true,
    notPurchaseReason: null,
    item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: "464306" },
    quantity: { amount: 500, unit: "L" },
    deliverBy: "2026-11-16",
    requiredClaims: ["organic"],
    forbiddenAllergens: ["nuts"],
    optimise: "unstated",
    sameAsLastTime: false,
    ...over,
  });
  it("removes a claim, allergen, product, amount and date the buyer did not say", () => {
    const g = groundInterpretation(raw({}), { text: "We need milk for the canteen." });
    expect(g.raw.item).toMatchObject({ text: "milk", attributes: [], productId: null });
    expect(g.raw).toMatchObject({ requiredClaims: [], forbiddenAllergens: [], quantity: null, deliverBy: null });
    expect(g.removed.map((v) => v.kind).sort()).toEqual(["allergen", "claim", "claim", "claim", "date", "number", "product"]);
    expect(fired("interpret")).toMatchObject({ checked: 1, fired: 1, removed: 7 });
  });
  it("keeps everything the buyer's words back, in Finnish too, and a follow-up's earlier request", () => {
    const g = groundInterpretation(raw({ requiredClaims: [], forbiddenAllergens: ["nuts"], item: { text: "laktoositon maito", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null }, quantity: { amount: 500, unit: "L" } }), { text: "Tarvitaan 500 litraa laktoositonta maitoa maanantaiksi, ei pähkinöitä." });
    expect(g.removed).toEqual([]);
    const f = groundInterpretation(raw({ requiredClaims: [], forbiddenAllergens: [], item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], excludedAttributes: [], productId: null }, quantity: { amount: 200, unit: "L" } }), { text: "same again but 200 litres for Monday", earlier: [{ need: { item: { attributes: ["lactose_free"] } } }] });
    expect(f.removed).toEqual([]);
  });
  it("keeps a day and an amount stated the way people say them (second reader's evaluation cases), and still removes invented ones", () => {
    const keep = (text: string, quantity: LlmNeed["quantity"], deliverBy: string) =>
      groundInterpretation(raw({ requiredClaims: [], forbiddenAllergens: [], item: { text: "x", category: null, attributes: [], excludedAttributes: [], productId: null }, quantity, deliverBy }), { text, today: "2026-11-14" });
    expect(keep("Huomiseksi 50 kiloa maustamatonta jogurttia", { amount: 50, unit: "kg" }, "2026-11-15").removed).toEqual([]);
    expect(keep("Kaksi tusinaa purkkia kermaa ylihuomiseksi", { amount: 24, unit: "pack" }, "2026-11-16").removed).toEqual([]);
    expect(keep("5 kg glutenfri riven mozzarella till den 19:e", { amount: 5, unit: "kg" }, "2026-11-19").removed).toEqual([]);
    expect(keep("Två dussin paket laktosfri grädde till måndag", { amount: 24, unit: "pack" }, "2026-11-16").removed).toEqual([]);
    expect(keep("We usually take 100 litres a week; this week we need double, lactose-free, by Monday", { amount: 200, unit: "L" }, "2026-11-16").removed).toEqual([]);
    // The other direction: a day the words do not name, the wrong day for "huomiseksi", an amount nobody said.
    expect(keep("Huomiseksi 50 kiloa maustamatonta jogurttia", { amount: 50, unit: "kg" }, "2026-11-16").removed.map((v) => v.kind)).toEqual(["date"]);
    expect(keep("Tarvitaan 300 l maitoa, ei kiirettä", { amount: 300, unit: "L" }, "2026-11-15").removed.map((v) => v.kind)).toEqual(["date"]);
    expect(keep("Tusina laatikkoa voita perjantaiksi", { amount: 13, unit: "pack" }, "2026-11-20").removed.map((v) => v.kind)).toEqual(["number"]);
  });

  it("through interpretNeed: an amount nobody said comes back as need_incomplete, so the buyer gives it", async () => {
    await expect(interpretNeed({ text: "Milk for Monday please", now: new Date("2026-11-13T12:00:00+02:00"), model: { ...scriptedModel([{ text: JSON.stringify(raw({ requiredClaims: [], forbiddenAllergens: [], item: { text: "milk", category: "milk", attributes: [], excludedAttributes: [], productId: null } })) }]), id: "scripted" } })).rejects.toMatchObject({ code: "need_incomplete" });
    expect(fired("interpret").fired).toBe(1);
  });
});

describe("memory proposals", () => {
  const cand = (over: Partial<LlmCandidate>): LlmCandidate => ({
    kind: "note", segmentId: "s1", quote: "keep the oat milk for the café", standing: true, oneOff: false, family: "", site: "", reason: "", allergen: "", claim: "", dimension: "none", choice: "none", productId: "", productName: "", brand: "",
    stance: "none", packSize: 0, unit: "none", weekdays: [], from: "", to: "", weeklyEuros: 0, forName: "", accepted: "none", amount: 0, low: 0, high: 0, months: [], description: "", goal: "none", text: "", ...over,
  });
  it("drops a note or a reason that rests on what the person did not say, keeps a backed one, and counts it", () => {
    const interaction = { id: "int_1", at: "2026-11-13T10:00:00Z", door: "typed" as const, segments: [{ id: "s1", source: "buyer" as const, text: "Please keep the oat milk for the café, the barista likes it." }], events: [] };
    const g = groundProposals(
      [
        toCandidate(cand({ text: "Oat milk for the café, 40 L every Friday, it is nut-free" })),
        toCandidate(cand({ text: "Keep the oat milk for the café" })),
        toCandidate(cand({ kind: "brand", brand: "Oatly", stance: "prefer", text: "", reason: "it is the cheapest at €1.20" })),
      ],
      interaction,
    );
    expect(g.kept).toHaveLength(2);
    expect(g.kept.find((c) => c.fact.kind === "brand")!.reason).toBeUndefined();
    expect(fired("memory")).toMatchObject({ checked: 1, fired: 1 });
  });
});

describe("Aiven agent transcript", () => {
  it("checks the agent's words against the tool answers before them", () => {
    const msgs = toRunMessages([
      { role: "user", message_type: "user_message", content: "60 litres of lactose-free milk by Wednesday" },
      { role: "tool", message_type: "tool_return_message", name: "dock-aiven_place_order", tool_return: JSON.stringify({ ok: true, order: { orderId: "ord_abc123", status: "committed", totalCents: 6600, lines: [{ name: "Eila skimmed milk drink 1 l lactose free", quantity: 60, unitPriceCents: 110, deliveryDate: "2026-11-16" }] } }) },
      { role: "assistant", message_type: "assistant_message", content: "Ordered 60 × 1 L for €66.00, delivered Monday 16 November. It is also organic.\nYou saved €12.40 against last week." },
    ]);
    expect(msgs[2].text).toBe(`Ordered 60 × 1 L for €66.00, delivered Monday 16 November. ${DATA_DOES_NOT_SAY}`);
    expect(fired("aiven")).toMatchObject({ checked: 1, fired: 1, removed: 2 });
  });
});

describe("the operations portal", () => {
  it("shows the counts in GET /ops-api/safeguards: a `grounding` field and the grounding_check rule's row", async () => {
    const { resetRuntime, getRuntime } = await import("./runtime");
    const { safeguards } = await import("./ops/views");
    resetRuntime();
    recordGrounding("assistant", [{ kind: "claim", said: "nut-free" }], "Is this nut-free?");
    recordGrounding("menu", []);
    const s = await safeguards(await getRuntime());
    expect(s.grounding.surfaces.assistant).toEqual({ checked: 1, fired: 1, removed: 1 });
    expect(s.grounding.totals).toEqual({ checked: 2, fired: 1, removed: 1 });
    const row = s.groups.flatMap((g) => g.rules).find((r) => r.rule === "grounding_check")!;
    expect(row).toMatchObject({ title: "Model text checked against the data", refused: 1, passed: 1 });
    expect(row.recent[0].reason).toContain('"nut-free"');
    resetRuntime();
  });
});
