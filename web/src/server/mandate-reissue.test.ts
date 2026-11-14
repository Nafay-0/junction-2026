import { beforeEach, describe, expect, it } from "vitest";
import { POST as memoryPost } from "@/app/ui-api/memory/kitchens/[kitchen]/route";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate, supersededBy } from "@/core/mandate";
import { menuKitchen } from "./agent/menu/runtime";
import { resolveKitchen } from "./console-kitchens";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { reissueKitchenMandate } from "./mandate-reissue";
import { MandateBook, expressible, type ReissueRecord } from "./mandates";
import { getMemoryService, resetMemoryService } from "./memory/runtime";
import { InMemoryRecordStore } from "./records";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * "Add to signed mandate". The kitchen's own signed-in person adds a remembered rule: the kitchen's mandate is
 * signed again with it, the gate enforces it on every door, and every mandate the kitchen signed before stops
 * working, including for an order that was waiting for sign-off under one of them.
 */
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const BY = "Sanna Koskinen (signed in)";

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  const g = globalThis as { __dockConsoleTokens?: unknown; __dockMenuTokens?: unknown; __dockMenu?: unknown };
  g.__dockConsoleTokens = g.__dockMenuTokens = g.__dockMenu = undefined;
  process.env.DOCK_MENU_MODEL = "recorded";
});

async function lactoseFreeOffer() {
  const memory = await getMemoryService();
  const k = (await resolveKitchen("kaari"))!;
  let offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
  if (!offers.some((o) => o.patch.requiredAttributes.includes("lactose_free"))) {
    await memory.write(k.info.orgId, { door: "memory_page", by: BY, segments: [], events: [{ type: "rule_stated", fact: { kind: "diet", claim: "lactose_free" }, strength: "rule" }] }, k.info.name);
    offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
  }
  return { memory, k, offer: offers.find((o) => o.patch.requiredAttributes.includes("lactose_free"))! };
}

describe("reissuing a built-in kitchen's mandate with a remembered rule", () => {
  it("the new mandate carries the rule, the old ones are refused at every door, and the ledger says what changed", async () => {
    const rt = await getRuntime();
    const { dock } = rt;
    const { memory, k, offer } = await lactoseFreeOffer();
    expect(k.info.mandate.requiredAttributes).not.toContain("lactose_free");
    const oldSession = await dock.authenticate(k.mandateToken, k.agentId);
    // Another agent of the kitchen, with a mandate the kitchen signed earlier (as the framework examples mint them).
    const longAgo = new Date(Date.now() - 3600_000);
    const otherAgent = await signMandate(demoKitchenMandate(longAgo, { agentId: "agent_kaari_other", mandateId: "mnd_kaari_other" }), await demoKitchenKeyPair());
    await expect(dock.authenticate(otherAgent, "agent_kaari_other")).resolves.toBeDefined();
    // An order waiting for sign-off under the old mandate: 100 L of lactose-free milk, over Kaari's EUR 100 limit.
    const req = await dock.openRequest(oldSession, { text: "milk", neededBy: day() });
    const q = await dock.requestQuote(oldSession, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 100 }] });
    const waiting = await dock.placeOrder(oldSession, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    expect(waiting.status).toBe("pending_approval");

    await new Promise((r) => setTimeout(r, 1100)); // a token's `iat` counts in seconds: let the earlier mandates be a second old
    const reissued = await reissueKitchenMandate(rt, k.info, offer.patch, BY);
    await memory.decideMandate(k.info.orgId, offer.itemId, "added", BY, reissued);
    expect(reissued).toMatchObject({ replaced: k.info.mandate ? expect.any(String) : "", added: { requiredAttributes: ["lactose_free"], forbiddenAllergens: [] }, before: { requiredAttributes: [] }, after: { requiredAttributes: ["lactose_free"] } });

    // The kitchen's store, connector address and on-site doors resolve the kitchen again and present the new mandate.
    const now = (await resolveKitchen("kaari"))!;
    expect(now.mandateToken).not.toBe(k.mandateToken);
    expect(now.info.mandate.requiredAttributes).toContain("lactose_free");
    const session = await dock.authenticate(now.mandateToken, now.agentId);
    expect(session.mandate).toMatchObject({ mandateId: reissued.mandateId, perOrderLimitCents: k.info.mandate.perOrderLimitCents, forbiddenAllergens: k.info.mandate.forbiddenAllergens });

    // Every mandate the kitchen signed before is refused: the store agent's old one, another agent's, a held session.
    const superseded = { status: 401, code: "mandate_superseded", rule: "mandate_window" };
    await expect(dock.authenticate(k.mandateToken, k.agentId)).rejects.toMatchObject(superseded);
    await expect(dock.authenticate(otherAgent, "agent_kaari_other")).rejects.toMatchObject(superseded);
    await expect(dock.admit(oldSession)).rejects.toMatchObject(superseded);
    // A session verified before the reissue cannot place an order either, and the waiting order is not committed.
    const stale = await dock.placeOrder(oldSession, { requestId: (await dock.openRequest(oldSession, { text: "milk" })).requestId, quoteToken: q.quoteToken, lines: [] });
    expect(stale.decision.rules.find((r) => r.rule === "mandate_window")).toMatchObject({ outcome: "fail", details: { superseded: true } });
    const link = rt.outbox.messages().find((m) => m.orderId === waiting.orderId)!.link;
    const signed = await dock.decideApproval(waiting.approval!.approvalId, { decision: "approve", proof: { kind: "link_token", token: new URL(link, "http://x").searchParams.get("token")! } });
    expect(signed.status).toBe("rejected");
    expect(signed.decision.rules.find((r) => r.rule === "mandate_window")?.reason).toMatch(/reissued its mandate on .* signed before that and no longer works/);

    // What the kitchen signs after the reissue is its current word: its own key is its authority.
    const later = await signMandate(demoKitchenMandate(new Date(), { agentId: "agent_kaari_other", mandateId: "mnd_kaari_other_2" }), await demoKitchenKeyPair());
    await expect(dock.authenticate(later, "agent_kaari_other")).resolves.toBeDefined();
    // The menu agent's mandate is signed again too, and is never wider than the console's.
    const menu = (await menuKitchen("kaari")).kitchen!;
    await expect(dock.authenticate(menu.mandateToken, menu.agentId)).resolves.toBeDefined();
    expect(menu.mandate.forbiddenAllergens).toContain("lactose");

    // The record: one ledger entry with before and after; the memory item names the mandate; nothing is offered twice.
    const entry = dock.ledger.entries().find((e) => e.data.step === "mandate_reissued")!;
    expect(entry.summary).toMatch(/reissued Ravintola Kaari's mandate with one more rule: every product lactose-free\..*Nothing else in the mandate changed\./);
    expect(entry.data).toMatchObject({ mandateId: reissued.mandateId, before: { requiredAttributes: [] }, after: { requiredAttributes: ["lactose_free"] }, signedWith: "the kitchen's configured key" });
    expect((await memory.mandateOffers(k.info.orgId, now.info.mandate)).some((o) => o.itemId === offer.itemId)).toBe(false);
    await expect(reissueKitchenMandate(rt, now.info, offer.patch, BY)).rejects.toMatchObject({ status: 409, code: "rule_already_in_mandate" });
  });

  it("only the kitchen's own signed-in person can do it: an open demo console cannot", async () => {
    const { offer, k } = await lactoseFreeOffer();
    const res = await memoryPost(new Request("http://dock.test/ui-api/memory/kitchens/kaari", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mandate", itemId: offer.itemId, decision: "added" }) }), { params: Promise.resolve({ kitchen: "kaari" }) } as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("kitchen_person_required");
    const { dock } = await getRuntime();
    await expect(dock.authenticate(k.mandateToken, k.agentId)).resolves.toBeDefined(); // nothing was reissued
  });
});

describe("reissuing a visitor kitchen's mandate", () => {
  it("signs with a new key of the kitchen, and the kitchen's agent presents the new mandate", async () => {
    const rt = await getRuntime();
    const { sandbox } = await rt.sandboxes.joinWithoutPasskey();
    const k = (await resolveKitchen(sandbox.sandboxId))!;
    await expect(rt.dock.authenticate(k.mandateToken, k.agentId)).resolves.toBeDefined();
    const reissued = await reissueKitchenMandate(rt, k.info, { forbiddenAllergens: ["soy"] }, sandbox.approverName);
    expect(reissued).toMatchObject({ signedWith: "a new key of the kitchen", added: { forbiddenAllergens: ["soy"], requiredAttributes: [] } });
    const now = (await resolveKitchen(sandbox.sandboxId))!;
    expect(now.info.mandate.forbiddenAllergens).toEqual([...k.info.mandate.forbiddenAllergens, "soy"]);
    await expect(rt.dock.authenticate(now.mandateToken, now.agentId)).resolves.toMatchObject({ mandate: { mandateId: reissued.mandateId } });
    await expect(rt.dock.authenticate(k.mandateToken, k.agentId)).rejects.toMatchObject({ code: "mandate_superseded" });
    // After a restart the kitchen's new key is the one trusted again (the store keeps the public half).
    expect(await rt.sandboxes.restore()).toBeGreaterThanOrEqual(1);
    await expect(rt.dock.authenticate(now.mandateToken, now.agentId)).resolves.toBeDefined();
  });
});

describe("what the mandate can and cannot state", () => {
  it("offers only rules in the mandate's vocabulary; a family-only rule is labelled as the intake's", async () => {
    expect(expressible({ forbiddenAllergens: ["pähkinä"] })).toEqual({ forbiddenAllergens: ["nuts"], requiredAttributes: [] });
    expect(expressible({ requiredAttributes: ["laktoositon"] })).toEqual({ forbiddenAllergens: [], requiredAttributes: ["lactose_free"] });
    expect(expressible({ forbiddenAllergens: ["dragonfruit"] })).toBeUndefined();
    const book = new MandateBook();
    await expect(book.reissue(demoKitchenMandate(new Date()), { forbiddenAllergens: ["dragonfruit"] }, BY)).rejects.toMatchObject({ status: 422, code: "rule_not_expressible" });

    const memory = await getMemoryService();
    const k = (await resolveKitchen("kaari"))!;
    await memory.write(k.info.orgId, { door: "memory_page", by: BY, segments: [], events: [{ type: "rule_stated", fact: { kind: "diet", claim: "organic" }, family: "cream", strength: "rule" }] }, k.info.name);
    const offers = await memory.mandateOffers(k.info.orgId, k.info.mandate);
    const view = await memory.view(k.info.orgId, k.info.name);
    const creamOnly = view.items.find((i: { family?: string; fact: { kind: string; claim?: string } }) => i.family === "cream" && i.fact.kind === "diet" && i.fact.claim === "organic");
    if (creamOnly) {
      expect(offers.some((o) => o.itemId === creamOnly.id)).toBe(false);
      expect(creamOnly.mandate).toMatchObject({ status: "intake_only" });
    }
  });

  it("the register survives a restart: a new process reads it back and refuses the same mandates", async () => {
    const store = new InMemoryRecordStore<ReissueRecord>();
    const before = new MandateBook();
    await before.restore(store);
    const old = demoKitchenMandate(new Date(Date.now() - 3600_000));
    const { mandate } = await before.reissue(old, { requiredAttributes: ["lactose_free"] }, BY);

    const after = new MandateBook(); // the process restarted
    expect(await after.restore(store)).toBe(1);
    expect(after.reissueOf(KITCHEN_ORG.orgId)).toMatchObject({ mandateIds: [mandate.mandateId], by: BY });
    expect(supersededBy(old, new Date(Date.now() - 3600_000).toISOString(), after)).toMatchObject({ orgId: KITCHEN_ORG.orgId });
    expect(supersededBy(mandate, undefined, after)).toBeUndefined();
    // Mandates the server signs for the kitchen afterwards carry what it added.
    expect(after.restrict(demoKitchenMandate(new Date()), { current: true })).toMatchObject({ mandateId: mandate.mandateId, requiredAttributes: ["lactose_free"] });
  });
});
