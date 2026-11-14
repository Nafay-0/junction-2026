import { beforeEach, describe, expect, it } from "vitest";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { AgentSession } from "@/core/orders";
import { resolveKitchen } from "./console-kitchens";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * A day of judging on one deployment: the partner's own example, signed off again and again on the built-in demo
 * kitchens. The weekly budget must not run out after the first rehearsal (QA wave 2, finding 2), and the
 * per-order limit must still send the 1,000 L order to a person every time.
 */
beforeEach(() => {
  process.env.DOCK_CATALOG = "seed";
  resetRuntime();
});

function nextWeekday(): string {
  let d = addDaysIso(localNow(new Date()).date, 1);
  while (isoWeekday(d) > 5) d = addDaysIso(d, 1);
  return d;
}

async function signedOrder(slug: "laakso" | "kaari", need: Record<string, unknown>, i: number) {
  const rt = await getRuntime();
  const k = (await resolveKitchen(slug))!;
  const session: AgentSession = await rt.dock.authenticate(k.mandateToken, k.agentId);
  let step = await rt.dock.intake.open(session, { need, by: `Judge ${i}` });
  for (let guard = 0; guard < 6 && step.state !== "quoted"; guard++) {
    if (step.state === "needs_confirmation") step = await rt.dock.intake.respondToConcerns(session, step.requestId, { by: `Judge ${i}`, responses: step.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) });
    else if (step.state === "needs_input") step = await rt.dock.intake.answer(session, step.requestId, { by: `Judge ${i}`, answers: step.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })) });
    else if (step.state === "options_ready") step = await rt.dock.intake.choose(session, step.requestId, { by: `Judge ${i}`, optionId: step.options[0].optionId });
    else throw new Error(`judge ${i} on ${slug}: ${step.state}: ${step.notes[0] ?? ""}`);
  }
  const q = step.quote!;
  const order = await rt.dock.placeOrder(session, { requestId: step.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  if (order.status === "committed") return order;
  expect(order.status).toBe("pending_approval");
  const msg = rt.outbox.messages().find((m) => m.approvalId === order.approval!.approvalId)!;
  const token = new URL(msg.link, "http://dock.test").searchParams.get("token")!;
  return rt.dock.decideApproval(msg.approvalId, { decision: "approve", proof: { kind: "link_token", token } });
}

describe("a day of demonstrations on the built-in demo kitchens", () => {
  it("takes the partner's 1,000 L example, signed off each time, again and again; and a Kaari order between them", async () => {
    const milk = { item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy: nextWeekday() };
    for (let i = 1; i <= 6; i++) {
      const o = await signedOrder("laakso", milk, i);
      expect(o.status, `run ${i}`).toBe("committed");
      expect(o.approval?.status, `run ${i}: the 1,000 L order still needs a person`).toBe("approved");
    }
    const kaari = await signedOrder("kaari", { item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" }, deliverBy: nextWeekday() }, 7);
    expect(kaari.status).toBe("committed");
  });
});
