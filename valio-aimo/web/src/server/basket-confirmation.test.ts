import { beforeEach, describe, expect, it } from "vitest";
import type { PublicOrder } from "@/core/orders";
import { KITCHEN_ORG } from "./demo-kitchen";
import { resolveKitchen } from "./console-kitchens";
import { basketPlace, basketQuote, type Kitchen } from "./kitchen-portal";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * The store's basket and the gate's mistake check. The check runs at the gate on every order, so a basket the
 * kitchen's own signed-in person built by hand was sent to sign-off: nobody had asked them. The basket now puts
 * the check's question to that person with the price, records their answer as the verified confirmation it is,
 * and the order commits. An order nobody identified confirmed still goes to a named person.
 */
const ORDINARY_MILK = "VA-1110"; // EUR 11.50 a box, within Kaari's EUR 100; against its chef's "always lactose-free"
type Bundle = { requestId: string; quoteToken: string; quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] }; policyPreview: { outcome: string; rules: { rule: string; outcome: string }[] }; concerns?: { key: string; message: string }[] };

beforeEach(() => {
  resetRuntime();
  (globalThis as { __dockConsoleTokens?: unknown }).__dockConsoleTokens = undefined;
});

/** Kaari's store as its console resolves it: with the kitchen's signed-in person at the screen, a phone on a call code, or nobody identified. */
async function store(person?: { callOnly?: true }): Promise<Kitchen> {
  const k = (await resolveKitchen("kaari"))!;
  return { ...k, console: { kitchen: "kaari", session: "test", ...(person ? { person: { channel: "portal_session" as const, name: "Ravintola Kaari (kaari)", account: "kaari", ...person } } : {}) } } as Kitchen;
}
const linesOf = (b: Bundle) => b.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }));

describe("the basket asks its signed-in person what the gate's mistake check would ask", () => {
  it("shows the question with the price, and their send is recorded as their own confirmation: the order commits", async () => {
    const k = await store({});
    const b = (await basketQuote(k, [{ productId: ORDINARY_MILK, packs: 1 }])).json as Bundle;
    expect(b.concerns?.map((c) => c.message).join(" ")).toMatch(/Always lactose-free/);
    // The preview is what the gate will decide once they confirm: no sign-off announced for the check.
    expect(b.policyPreview.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("pass");
    expect(b.policyPreview.outcome).toBe("auto_approve");

    const placed = await basketPlace(k, { requestId: b.requestId, quoteToken: b.quoteToken, lines: linesOf(b), confirm: b.concerns!.map((c) => c.key) });
    const order = (placed.json as { order: PublicOrder }).order;
    expect(order.status).toBe("committed");
    expect(order.totalCents).toBe(1150);
    expect(order.decision.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("pass");
    const { dock } = await getRuntime();
    const said = dock.ledger.entries({ requestId: b.requestId }).filter((e) => e.data.step === "confirmation");
    expect(said.length).toBe(b.concerns!.length);
    expect(said[0]).toMatchObject({ actor: "buyer:Ravintola Kaari (kaari)", data: { verified: true, channel: "portal_session" } });
    expect(said.map((e) => e.summary).join(" ")).toMatch(/confirmed as intended, in the kitchen's signed-in store, before sending the order: .*Always lactose-free/);
  });

  it("an order nobody confirmed still goes to sign-off: the person did not confirm, or nobody identified is at the screen", async () => {
    // The signed-in person sends without the confirmation (an older page, a script with their cookie).
    const k = await store({});
    const b = (await basketQuote(k, [{ productId: ORDINARY_MILK, packs: 1 }])).json as Bundle;
    const unconfirmed = ((await basketPlace(k, { requestId: b.requestId, quoteToken: b.quoteToken, lines: linesOf(b) })).json as { order: PublicOrder }).order;
    expect(unconfirmed.status).toBe("pending_approval");
    expect(unconfirmed.decision.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("escalate");

    // Nobody identified (the operations desk looking at the kitchen), and a phone that came in by the call code:
    // no question is shown, a confirmation sent anyway is ignored, and the order waits for the signer.
    for (const viewer of [await store(), await store({ callOnly: true })]) {
      const q = (await basketQuote(viewer, [{ productId: ORDINARY_MILK, packs: 1 }])).json as Bundle;
      expect(q.concerns).toBeUndefined();
      expect(q.policyPreview.rules.find((r) => r.rule === "human_confirmation")?.outcome).toBe("escalate");
      const order = ((await basketPlace(viewer, { requestId: q.requestId, quoteToken: q.quoteToken, lines: linesOf(q), confirm: ["contradicts_preference:anything", ...(b.concerns ?? []).map((c) => c.key)] })).json as { order: PublicOrder }).order;
      expect(order.status).toBe("pending_approval");
    }
  });

  it("the core takes a confirmation only through a channel bound to a person, and only for concerns of that quote", async () => {
    const { dock } = await getRuntime();
    const k = (await resolveKitchen("kaari"))!;
    const session = await dock.authenticate(k.mandateToken, k.agentId);
    const req = await dock.openRequest(session, { text: "milk" });
    const { quoteToken } = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: ORDINARY_MILK, quantity: 1 }] });
    const open = await dock.orderConcerns(session, { requestId: req.requestId, quoteToken });
    expect(open.length).toBeGreaterThan(0);
    const keys = open.map((c) => c.key);
    for (const via of [{ channel: "relayed" as const }, { channel: "protocol_elicitation" as const, person: "Sanna" }, { channel: "answer_link" as const }, { channel: "portal_session" as const }]) {
      await expect(dock.confirmConcerns(session, { requestId: req.requestId, quoteToken, keys }, via)).rejects.toMatchObject({ status: 403, code: "confirmation_needs_person" });
    }
    expect(await dock.orderConcerns(session, { requestId: req.requestId, quoteToken })).toHaveLength(open.length);
    const r = await dock.confirmConcerns(session, { requestId: req.requestId, quoteToken, keys: ["quantity_tenfold:made-up", keys[0]] }, { channel: "portal_session", person: "Sanna Koskinen" });
    expect(r.confirmed.map((c) => c.key)).toEqual([keys[0]]);
    expect(r.open.map((c) => c.key)).toEqual(keys.slice(1));
    // Another quote of the same request is asked about again: the confirmation was for that quote.
    const again = await dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: ORDINARY_MILK, quantity: 2 }] });
    expect((await dock.orderConcerns(session, { requestId: req.requestId, quoteToken: again.quoteToken })).length).toBeGreaterThan(0);
    void KITCHEN_ORG;
  });
});
