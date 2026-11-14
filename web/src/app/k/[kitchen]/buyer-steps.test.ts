import { describe, expect, it } from "vitest";
import { briefOf } from "@/server/thread/watch";
import { buyerSteps, plainStep, stepLeaks } from "./buyer-steps";

/**
 * The steps under a reply are open from the start, so they are read by the buyer: no ISO time, no id, no code, no
 * protocol name, whatever a card carried. Trace-grade lines as the watch, the offer and the backup write them.
 */
const TRACE = [
  "Watched the kitchen's key products (its recurring orders and the orders on their way) with one live availability call, cached ten minutes.",
  "Valio Eila® semi skimmed milk drink 10 l novobox lactose free for 2026-11-16 (recurring order, 420 L): the order cut-off for that day has passed (cutoff 2026-11-12T15:00:00+0200); earliest 2026-11-20.",
  "Substitutes from the knowledge map (8), the wholesaler's list and the product search (11, judge); 3 priced in one more live call for 2026-11-16.",
  "1: Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free: 31.31 EUR/Kl, product 463038. Inside the kitchen's preferences: the agent may order it alone.",
  "Ordering one goes through the gate like any order: the mandate's substitution rule (within_preferences) and limits decide.",
  "Signed availability claim clm_8f2a1c (vc+jwt, Ed25519, simulated: true), checkable against /.well-known/jwks.json.",
  "Signed offer ofr_e155c8cf8c5a4859 (vc+jwt, Ed25519); holds until 2026-11-15T17:04:37.625Z.",
  "Order ord_42a451f3a8ee4624: committed; request req_aee0d9fb6ba749ad.",
  "STAGED: the stock-out was staged by operations staff for the demo; the partner's live figures are unchanged.",
];

describe("steps a buyer reads", () => {
  for (const lang of ["en", "fi", "sv"] as const)
    it(`never shows an ISO time, an id, a code or a protocol name (${lang})`, () => {
      const shown = buyerSteps(TRACE, lang);
      for (const s of shown) expect(stepLeaks(s), s).toBeUndefined();
      expect(shown.length).toBeLessThanOrEqual(4);
      for (const l of TRACE) {
        const p = plainStep(l, lang);
        if (p) expect(stepLeaks(p), p).toBeUndefined();
      }
    });

  it("says days as people write them and money in euros, and cuts a long list", () => {
    expect(plainStep("Due 2026-11-12T15:00:00+0200 at 31.31 EUR/Kl.", "en")).toBe("Due Thu 12 Nov 15.00 at 31,31 €/kg.");
    const many = Array.from({ length: 6 }, (_, i) => `A plain step number ${i + 1}.`);
    expect(buyerSteps(many, "en")).toEqual(["A plain step number 1.", "A plain step number 2.", "A plain step number 3.", "And 3 more."]);
  });

  it("the watch's own lines for the buyer, in each language, are plain", () => {
    const finding = { product: { name: "Valio Eila® semi skimmed milk drink 10 l novobox lactose free" }, need: { date: "2026-11-16" }, problems: ["cutoff_passed"], shortfall: { backOn: "2026-11-20" }, substitutes: [{ name: "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free" }, { name: "Valio semi skimmed milk 1 l lactose free UHT" }] };
    const renewal = { product: { name: "Valio whipping cream 20 l" }, basedOn: { orders: 8, weeks: [1, 2, 3, 4] }, amounts: { usual: 320, unit: "L" }, drift: { portions: { pct: 37, since: "2026-10-19" } }, autoRenew: { on: true } };
    for (const lang of ["en", "fi", "sv"] as const) {
      const a = briefOf({ id: "wf_1", kind: "stock_out", say: "", answers: [], steps: [], facts: { finding }, staged: true } as never, lang);
      const b = briefOf({ id: "wr_1", kind: "renewal_held", say: "", answers: [], steps: [], facts: { renewal }, staged: false } as never, lang);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(1);
      for (const s of [...a, ...b]) expect(stepLeaks(s), s).toBeUndefined();
    }
    expect(briefOf({ id: "wf_1", kind: "stock_out", say: "", answers: [], steps: [], facts: { finding }, staged: false } as never, "en")[0]).toBe("Valio Eila semi skimmed, Mon 16 Nov: the order cut-off has passed, back Fri 20 Nov.");
  });
});
