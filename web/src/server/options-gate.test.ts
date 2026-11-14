import { beforeEach, describe, expect, it } from "vitest";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import type { AgentSession, Dock } from "@/core/orders";
import { resolveKitchen } from "./console-kitchens";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * Two things the lane must hold, pinned here for the branch that changes the substitution path
 * (claude/agent-thread-2). Written against the core's own calls, which every door ends in.
 *
 *  1. No option is ever offered that the gate's own preview would refuse. A card the buyer can tap must not lead
 *     to a refusal by a rule the intake could have checked (a swap over the mandate's price tolerance, say).
 *  2. An alternative the buyer picks instead of the product they asked for is a substitute to the gate, on every
 *     door: judged by the mandate's substitution rule and price tolerance against the product asked for.
 */
const day = () => nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
const BOX = "VA-1010"; // 10 L bag-in-box, 600 L in stock on the seed: 1,000 L cannot be had from it alone
const WITHIN = "AR-2010"; // +6.2 % per litre: within Laakso's 10 % tolerance
const OVER = "JP-3010"; // +25.6 % per litre: over it

let dock: Dock;
let session: AgentSession;
beforeEach(async () => {
  resetRuntime();
  (globalThis as { __dockConsoleTokens?: unknown }).__dockConsoleTokens = undefined;
  ({ dock } = await getRuntime());
  const k = (await resolveKitchen("laakso"))!; // substitutes need approval, at most +10 % per litre
  session = await dock.authenticate(k.mandateToken, k.agentId);
});

/** Drive an intake to its option cards, answering as the agent would relay. */
async function cards(need: Record<string, unknown>) {
  let step = await dock.intake.open(session, { need: need as never, by: "Aino" });
  for (let i = 0; i < 6 && (step.state === "needs_confirmation" || step.state === "needs_input"); i++) {
    step =
      step.state === "needs_confirmation"
        ? await dock.intake.respondToConcerns(session, step.requestId, { by: "Aino", responses: step.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) })
        : await dock.intake.answer(session, step.requestId, { by: "Aino", answers: step.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })) });
  }
  return step;
}

describe("1. no option is offered that the gate's own preview would refuse", () => {
  const needs: [string, Record<string, unknown>][] = [
    ["the partner's example: 1,000 L where the first choice has 600 L", { text: "1000 L lactose-free milk", item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 1000, unit: "L" }, deliverBy: day(), optimise: "price" }],
    ["a small order of a named product", { text: "100 L of the 10 L box", item: { text: "lactose-free milk 10 L", category: "milk", productId: BOX }, quantity: { amount: 100, unit: "L" }, deliverBy: day() }],
    ["lowest CO2", { text: "200 L lactose-free milk, lowest CO2", item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 200, unit: "L" }, deliverBy: day(), optimise: "co2" }],
  ];
  // OPEN on main (Sat 14 Nov), for claude/agent-thread-2 to close: asked for 1,000 L of the 10 L box (600 L in stock),
  // the intake offers "500 x JP-3010 + 50 x VA-1010", and the gate refuses it (substitute_price: +25.6 % per litre
  // against a 10 % tolerance). Remove `.fails` on the branch that makes options obey the gate's substitution rule.
  it.fails("a named product that cannot cover the amount", () => offered({ text: "1000 L of the 10 L box", item: { text: "lactose-free milk 10 L", category: "milk", productId: BOX }, quantity: { amount: 1000, unit: "L" }, deliverBy: day() }));

  it.each(needs)("%s", async (_name, need) => offered(need));

  async function offered(need: Record<string, unknown>) {
    const first = await cards(need);
    const refused: string[] = [];
    if (first.state === "quoted") {
      // The intake fixed the price itself (one option, nothing to choose): that quote must stand at the gate too.
      expect(first.quote?.policyPreview.outcome).not.toBe("reject");
      return;
    }
    expect(first.state).toBe("options_ready");
    expect(first.options.length).toBeGreaterThan(0);
    for (const card of first.options) {
      // A fresh request per card: choosing fixes a price for that one.
      const step = await cards(need);
      const same = step.options.find((o) => o.lines.map((l) => `${l.productId}x${l.packs}`).join("+") === card.lines.map((l) => `${l.productId}x${l.packs}`).join("+"));
      if (!same) continue;
      const quoted = await dock.intake.choose(session, step.requestId, { optionId: same.optionId, by: "Aino" });
      const preview = quoted.quote?.policyPreview;
      if (!preview || preview.outcome === "reject") refused.push(`${card.lines.map((l) => `${l.packs} x ${l.productId}`).join(" + ")}: ${preview?.rules.filter((r) => r.outcome === "fail").map((r) => `${r.rule}: ${r.reason}`).join(" | ") ?? quoted.state}`);
    }
    expect(refused).toEqual([]);
  }
});

describe("2. an alternative picked instead of the product asked for is a substitute to the gate", () => {
  async function askedForTheBox() {
    const step = await cards({ text: "100 L of the 10 L box", item: { text: "lactose-free milk 10 L", category: "milk", productId: BOX }, quantity: { amount: 100, unit: "L" }, deliverBy: day() });
    expect(["options_ready", "quoted"]).toContain(step.state);
    return step.requestId;
  }

  it("within the price tolerance it goes to a person (Laakso: substitutes need approval), named as replacing the product asked for", async () => {
    const requestId = await askedForTheBox();
    const { quote, policyPreview } = await dock.requestQuote(session, { requestId, lines: [{ productId: WITHIN, quantity: 10 }] });
    expect(quote.lines[0].substituteFor?.productId).toBe(BOX);
    expect(policyPreview.rules.find((r) => r.rule === "substitution_rule")?.outcome).toBe("escalate");
    expect(policyPreview.rules.find((r) => r.rule === "substitute_price")?.outcome).toBe("pass");
    expect(policyPreview.outcome).toBe("needs_human_approval");
  });

  it("over the price tolerance it is refused, whatever the agent declares about it", async () => {
    const requestId = await askedForTheBox();
    for (const line of [{ productId: OVER, quantity: 100 }, { productId: OVER, quantity: 100, substituteFor: OVER === BOX ? WITHIN : undefined }]) {
      const { policyPreview, quote, quoteToken } = await dock.requestQuote(session, { requestId, lines: [line] });
      expect(quote.lines[0].substituteFor?.productId).toBe(BOX);
      expect(policyPreview.rules.find((r) => r.rule === "substitute_price")?.outcome).toBe("fail");
      const order = await dock.placeOrder(session, { requestId, quoteToken, lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
      expect(order.status).toBe("rejected");
    }
  });
});
