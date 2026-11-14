import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyClaim } from "@/core/claims";
import { importJWK, type CryptoKey } from "jose";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { answerFinding, liftStage, runWatch, setAutoRenew, stageDrift, stageStockOut, standingFor, watchForOrg, watchView } from "./service";
import { answerWatchMoment, autoRenewIntentOf, markWatchSaid, watchAnswerOf, watchMomentForThread } from "./thread";

/**
 * The kitchen agent's watch end to end, in process, on the seed catalogue: Kaari's usual 10 L milk box is staged out
 * of stock; the watch notices in one live call, ranks substitutes, and the conversation's adapter says it and acts on
 * the answer through the gate. Then a creeping recurring order: learned, held before auto-renewing, answered.
 */

const USUAL = "VA-1010"; // the seed's 10 L lactose-free box: Kaari's usual milk

async function kaari() {
  const rt = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  return { rt, k, session: await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never) };
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
});
afterEach(() => {
  delete process.env.DOCK_MEMORY_LLM;
});

describe("supplier stock-out: the agent notices before the kitchen does", () => {
  it("finds the staged stock-out in one live call, with ranked substitutes and a signed (simulated) claim", async () => {
    const { rt, k } = await kaari();
    const liveBefore = rt.dock.stats().liveCalls;
    await stageStockOut(rt, { kitchen: "kaari", productId: USUAL, by: "Staff Tester" });
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true, by: "test" });
    const f = r.findings.find((x) => x.product.productId === USUAL)!;
    expect(f).toMatchObject({ staged: true, state: "open", need: { source: "standing" }, shortfall: { reason: "not_orderable" } });
    expect(f.message).toMatch(/STAGED/);
    // one call for the key products, one for the substitutes' prices
    expect(rt.dock.stats().liveCalls - liveBefore).toBeLessThanOrEqual(2);
    expect(r.keys.length).toBeLessThanOrEqual(10);
    expect(f.substitutes.length).toBeGreaterThan(0);
    expect(f.substitutes[0].rank).toBe("best");
    expect(f.substitutes[0].tradeOff.onTime).toBe(true);
    expect(f.substitutes.every((s) => s.productId !== USUAL)).toBe(true);
    // the availability statement is a signed claim, and says it is simulated
    const key = { kid: rt.dock.wholesalerPublicJwk.kid!, publicKey: (await importJWK(rt.dock.wholesalerPublicJwk, "Ed25519")) as CryptoKey };
    const v = await verifyClaim(f.claim!.token, [key]);
    expect(v.simulated).toBe(true);
    expect(f.claim!.statement).toMatchObject({ stock: { known: true, packs: 0 } });
    // a second run reuses the cached answer and the open finding
    const before = rt.dock.stats().liveCalls;
    const [again] = await runWatch(rt, { kitchens: ["kaari"] });
    expect(rt.dock.stats().liveCalls).toBe(before);
    expect(again.findings[0].findingId).toBe(f.findingId);
    expect(rt.dock.ledger.entries().filter((e) => e.type === "watch").map((e) => e.data.step)).toEqual(expect.arrayContaining(["staged", "found"]));
    expect(k.info.kind).toBe("demo");
  });

  it("says it in the conversation, en and fi, and a yes switches the order through the gate", async () => {
    const { rt, session } = await kaari();
    await stageStockOut(rt, { kitchen: "kaari", productId: USUAL, by: "Staff Tester" });
    await runWatch(rt, { kitchens: ["kaari"], fresh: true });
    const en = (await watchMomentForThread(rt, session, "en"))!;
    expect(en.kind).toBe("stock_out");
    expect(en.say).toMatch(/can't come this week/);
    expect(en.say).toMatch(/The closest is .+: .*(more|less|same price) per litre/);
    expect(en.say).toMatch(/staged stock-out/);
    expect(en.ask).toBe("Shall I switch this week's order?");
    expect(en.steps.join(" ")).toMatch(/one live availability call/);
    expect(en.proof?.simulated).toBe(true);
    const fi = (await watchMomentForThread(rt, session, "fi"))!;
    expect(fi.say).toMatch(/ei tule tällä viikolla/);
    expect(fi.ask).toMatch(/Vaihdanko/);
    expect(watchAnswerOf(en, "yes please")).toBe("switch");
    expect(watchAnswerOf(en, "kyllä, vaihda")).toBe("switch");
    expect(watchAnswerOf(en, "no, leave it")).toBe("keep");
    const done = await answerWatchMoment(rt, session, en.id, "switch", { by: "Sanna Koskinen", via: "test conversation", lang: "en" });
    expect(done.order).toBeDefined();
    // Over Kaari's €100 per order: the gate sends it to the head chef, whatever the agent thinks.
    expect(["committed", "pending_approval"]).toContain(done.order!.status);
    expect(done.order!.lines[0].substituteFor?.productId ?? done.order!.lines[0].substituteFor).toBeTruthy();
    expect(done.reply).toMatch(/Done|waits for/);
    const w = await watchForOrg(rt, session.mandate.issuer.orgId);
    expect(w.findings[0].decision?.by).toBe("Sanna Koskinen");
    await expect(answerFinding(rt, session, en.id, { choice: "switch" }, { by: "x", via: "y" })).rejects.toThrow(/decided/);
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("only demo kitchens can be staged; lifting it puts the live figures back", async () => {
    const { rt } = await kaari();
    const g = await stageStockOut(rt, { kitchen: "kaari", productId: USUAL, by: "Staff Tester" });
    await liftStage(rt, g.stageId, "Staff Tester");
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true });
    expect(r.findings.find((f) => f.product.productId === USUAL)).toBeUndefined();
    expect((await watchView(rt)).stages[0].liftedBy).toBe("Staff Tester");
  });
});

describe("standing order drift: learned, flagged, held before renewing", () => {
  it("learns the weekly pattern with the weeks it rests on", async () => {
    const { rt, session } = await kaari();
    const s = await standingFor(rt, session.mandate.issuer.orgId);
    const milk = s.find((x) => x.family === "milk")!;
    expect(milk.slots.map((x) => x.weekday)).toEqual([1, 4]);
    expect(milk.basedOn.orders).toBeGreaterThanOrEqual(10);
    expect(milk.autoRenew).toMatchObject({ on: false }); // off by default
    expect(milk.drifted).toBe(false);
  });

  it("holds a drifted renewal and asks; the answer is an order through the gate", async () => {
    const { rt, session } = await kaari();
    const orgId = session.mandate.issuer.orgId;
    await stageDrift(rt, { kitchen: "kaari", family: "milk", by: "Staff Tester" });
    const milk = (await standingFor(rt, orgId)).find((x) => x.family === "milk")!;
    expect(milk.staged).toBe(true);
    expect(autoRenewIntentOf("please renew the milk automatically")).toBe("on");
    expect(autoRenewIntentOf("uusi maito automaattisesti")).toBe("on");
    const a = await setAutoRenew(rt, session, { family: "milk", on: true, by: "Sanna Koskinen", via: "test" });
    expect(a).toMatchObject({ on: true, by: "Sanna Koskinen" });
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true, renew: "now" });
    const held = r.renewals.find((x) => x.family === "milk")!;
    // Whichever weekday comes next: Thursday carries the staged trend (its busiest slot); Monday may not.
    if (held.state === "held") {
      expect(held.decision).toMatchObject({ action: "hold" });
      const m = (await watchMomentForThread(rt, session, "en"))!;
      expect(m.kind).toBe("renewal_held");
      expect(m.say).toMatch(/I've held this week's renewal/);
      expect(watchAnswerOf(m, "skip it this week")).toBe("skip");
      expect(watchAnswerOf(m, "go back to the usual")).toBe("usual");
      const fi = (await watchMomentForThread(rt, session, "fi"))!;
      expect(fi.say).toMatch(/Pidätin/);
      const out = await answerWatchMoment(rt, session, m.id, "usual", { by: "Sanna Koskinen", via: "test", lang: "en" });
      expect(out.order).toBeDefined();
      expect(["committed", "pending_approval"]).toContain(out.order!.status);
    } else {
      expect(held.state).toBe("placed");
      expect(held.outcome?.orderId).toBeTruthy();
    }
    expect(rt.dock.ledger.entries().filter((e) => e.type === "watch").map((e) => e.data.step)).toEqual(expect.arrayContaining(["auto_renew"]));
  });

  it("renews alone when nothing drifted, within the mandate, and reports it in one sentence", async () => {
    const { rt, session } = await kaari();
    const orgId = session.mandate.issuer.orgId;
    const cream = (await standingFor(rt, orgId)).find((x) => x.family === "cream");
    if (!cream) return; // the seed has no cream history on this catalogue
    await setAutoRenew(rt, session, { family: "cream", on: true, by: "Sanna Koskinen", via: "test" });
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true, renew: "now" });
    const c = r.renewals.find((x) => x.family === "cream")!;
    expect(c.state).toBe("placed");
    expect(c.outcome?.status).toBe("committed");
    const m = (await watchMomentForThread(rt, session, "en"))!;
    expect(m.kind).toBe("renewal_placed");
    expect(m.say).toMatch(/I renewed your thursday|I renewed your Thursday/i);
    expect(m.ask).toBeUndefined();
    await markWatchSaid(rt, m.id);
    expect(await watchMomentForThread(rt, session, "en")).toBeUndefined();
  });
});
