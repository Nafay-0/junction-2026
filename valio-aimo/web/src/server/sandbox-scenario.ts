import { DockError, type AgentSession, type Dock, type PublicOrder } from "@/core/orders";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";

/**
 * The scripted buyer for a visitor kitchen: the partner's example, "I need 1,000 litres of lactose-free milk by
 * Monday", run through the same intake and order flow as any agent (structured need -> mistake check -> live
 * lookup of a short list -> ranked options -> signed quote -> order). Fixed logic, no LLM. It names no product:
 * Dock picks from the catalogue it runs on, and the kitchen's memory settles what the request leaves open.
 *
 * Where a person would answer, the script answers as the visitor (recorded under `by`): it confirms a warning,
 * takes the first correction of an error, and chooses the pre-selected (or first-ranked) option.
 */
export const SCENARIO_TEXT = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";

/** The next Monday after today, counted in Helsinki days (just after midnight there it is already the next day). */
export function nextMonday(from: Date): string {
  const today = localNow(from).date;
  const add = (8 - isoWeekday(today)) % 7 || 7;
  return addDaysIso(today, add);
}

/** The structured need an agent would make of SCENARIO_TEXT. */
export function scenarioNeed(opts: { litres?: number; now?: Date } = {}) {
  return {
    text: SCENARIO_TEXT,
    item: { text: "lactose-free milk", category: "milk" },
    quantity: { amount: opts.litres ?? 1000, unit: "L" as const },
    deliverBy: nextMonday(opts.now ?? new Date()),
    requiredClaims: ["lactose_free"],
    optimise: "price" as const, // "based on price and availability"
  };
}

export async function runKitchenScenario(dock: Dock, session: AgentSession, opts: { litres?: number; now?: Date; by?: string } = {}): Promise<PublicOrder> {
  const by = opts.by ?? "scripted buyer";
  let step = await dock.intake.open(session, { need: scenarioNeed(opts), by });
  for (let turn = 0; turn < 6 && step.state !== "quoted"; turn++) {
    if (step.state === "needs_confirmation") {
      step = await dock.intake.respondToConcerns(session, step.requestId, { by, responses: step.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : (c.corrections[0]?.id ?? "confirm") })) });
    } else if (step.state === "needs_input") {
      step = await dock.intake.answer(session, step.requestId, { by, answers: step.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id })) });
    } else if (step.state === "options_ready") {
      step = await dock.intake.choose(session, step.requestId, { by, optionId: step.preselected?.optionId ?? step.options[0].optionId });
    } else {
      throw new DockError(409, "scenario_no_options", step.notes[0] ?? `The request ended as ${step.state}.`, undefined, { excluded: step.excluded });
    }
  }
  if (step.state !== "quoted" || !step.quote) throw new DockError(409, "scenario_stuck", `The scripted buyer could not get a quote (state ${step.state}).`);
  const { quote, quoteToken } = step.quote;
  return dock.placeOrder(session, {
    requestId: step.requestId,
    quoteToken,
    lines: quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
  });
}
