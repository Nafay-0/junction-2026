import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import type { AgentSession } from "@/core/orders";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { getRuntime, resetRuntime } from "./runtime";

// What can be ordered, renewed or needs a second look depends on today's date (order cut-offs, delivery days, how
// recent the kitchen's history is), so these scenarios gave another result on some weekdays and times of day. A
// fixed morning (Date only; timers stay real), the same one the menu, sample and conversation tests use; set at the
// top of the file because some scenarios work out their dates when the file loads.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
afterAll(() => vi.useRealTimers());

/**
 * The partner's own headline request never ends in a dead end. "1000 litraa laktoositonta maitoa maanantaiksi" (as
 * the interpreter reads it) ends, for every kitchen, fresh and after earlier orders used part of the budget, in
 * exactly one of three states: an order placed, an order waiting for a named person, or a concrete offer the buyer
 * can accept (a card). Never "nothing fits" with nothing to do.
 */
const monday = () => {
  const today = localNow(new Date()).date;
  for (let i = 1; i <= 7; i++) if (isoWeekday(addDaysIso(today, i)) === 1) return addDaysIso(today, i);
  return today;
};
const headline = () => ({ text: "1000 litraa laktoositonta maitoa maanantaiksi", item: { text: "laktoositonta maitoa", attributes: ["lactose_free"], excludedAttributes: [] }, quantity: { amount: 1000, unit: "L" as const }, deliverBy: monday(), optimise: "unstated" as const });

type End = "placed" | "waiting" | "offer";

/** As the kitchen would: confirm what it meant, take the pre-selected (or first) card, place it; a person signs. */
async function run(session: AgentSession, sign: boolean): Promise<{ end: End | "dead_end"; why: string }> {
  const { dock, outbox } = await getRuntime();
  let s = await dock.intake.open(session, { need: headline(), by: "the buyer" });
  for (let i = 0; i < 6; i++) {
    if (s.state === "needs_confirmation") s = await dock.intake.respondToConcerns(session, s.requestId, { by: "the buyer", responses: s.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) });
    else if (s.state === "needs_input") s = await dock.intake.answer(session, s.requestId, { by: "the buyer", answers: s.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })) });
    else break;
  }
  if (s.state === "no_options" || s.state === "cancelled") return { end: "dead_end", why: s.notes.join(" ") };
  if (s.state === "options_ready" && s.options.every((o) => o.match === "compromise") && !sign) return { end: "offer", why: s.options[0].givesUp.map((g) => g.text).join(" ") };
  if (s.state === "options_ready") s = await dock.intake.choose(session, s.requestId, { by: "the buyer", optionId: s.preselected?.optionId ?? s.options[0].optionId });
  if (s.state !== "quoted") return { end: "dead_end", why: `ended ${s.state}` };
  if (s.quote!.policyPreview.outcome === "reject") return { end: "dead_end", why: s.quote!.policyPreview.reasons.join(" ") };
  const order = await dock.placeOrder(session, { requestId: s.requestId });
  if (order.status === "committed") return { end: "placed", why: `€${order.totalCents / 100}` };
  if (order.status !== "pending_approval") return { end: "dead_end", why: order.status };
  if (sign) {
    const link = outbox.messages().find((m) => m.approvalId === order.approval!.approvalId)!.link;
    await dock.decideApproval(order.approval!.approvalId, { decision: "approve", proof: { kind: "link_token", token: new URL(link, "http://x").searchParams.get("token")! } });
  }
  return { end: "waiting", why: `waits for ${order.approval!.approver.name}` };
}

beforeEach(() => resetRuntime());

describe("the partner's headline request never ends in a dead end", () => {
  const kitchens: [string, () => Promise<AgentSession>][] = [
    ["Laakso", async () => (await getRuntime()).dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId)],
    ["Kaari", async () => (await getRuntime()).dock.authenticate(await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair()), KITCHEN_ORG.agentId)],
    [
      "a visitor kitchen",
      async () => {
        const rt = await getRuntime();
        const { sandbox } = await rt.sandboxes.joinWithoutPasskey();
        const { resolveKitchen } = await import("./console-kitchens");
        const r = (await resolveKitchen(sandbox.sandboxId))!;
        return rt.dock.authenticate(r.mandateToken, r.agentId);
      },
    ],
  ];

  it.each(kitchens)("%s: fresh, and again after signed orders have used part of the budget", async (_name, session) => {
    const s = await session();
    const ends: string[] = [];
    // A visitor's approver signs with a passkey on their phone: here their orders wait, holding the budget.
    const sign = _name !== "a visitor kitchen";
    for (let round = 0; round < 3; round++) {
      const r = await run(s, sign);
      ends.push(r.end);
      if (process.env.HEADLINE_LOG) console.log(`${_name} round ${round + 1}: ${r.end} (${r.why})`);
      expect(r.end, r.why).not.toBe("dead_end");
    }
    expect(ends[0]).toMatch(/placed|waiting/);
  });

  it("Laakso under the €2,000 hard weekly budget of the deployed mandate: after one signed 1,000 L order, the most that fits now is offered, the rule named with its numbers", async () => {
    const rt = await getRuntime();
    const s = await rt.dock.authenticate(await signMandate(demoMandate(new Date(), { weeklyBudgetCents: 200_000 }), await demoOrgKeyPair()), DEMO_ORG.agentId);
    expect((await run(s, true)).end).toBe("waiting");
    const again = await rt.dock.intake.open(s, { need: headline(), by: "the buyer" });
    let step = again;
    if (step.state === "needs_confirmation") step = await rt.dock.intake.respondToConcerns(s, step.requestId, { by: "the buyer", responses: step.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) });
    expect(step.state).toBe("options_ready");
    expect(step.options[0].givesUp[0]).toMatchObject({ part: "amount", code: "partial_weekly_budget" });
    expect(step.notes.join(" ")).toMatch(/The weekly budget is the blocker: €\d[\d,.]* is left of €2,000\.00 this week, and it is a hard cap that no one can sign past/);
    // Taking it orders the part that fits, through the same gate.
    const taken = await rt.dock.intake.choose(s, step.requestId, { by: "the buyer", optionId: step.options[0].optionId });
    expect(taken.need.quantity!.amount).toBeLessThan(1000);
    const order = await rt.dock.placeOrder(s, { requestId: step.requestId });
    expect(["committed", "pending_approval"]).toContain(order.status);
  });
});
