import type { IntakeView } from "@/core/intake";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { answerLinkFor } from "./answer-links";
import { publicBaseUrl } from "./config";
import { consoleContextOf } from "./console-context";
import { nextStepForIntake, nextStepForOrder, waitingFor } from "./mcp/next-step";

/**
 * What a REST reply carries besides the step itself: the same `waitingFor` and `nextStep` guidance an MCP result
 * carries (one sentence naming the call to make, and whose move it is), and on a step that waits for the buyer the
 * one-time `answerUrl` for them (server/answer-links.ts). The kitchen's own console has the buyer at the screen, so
 * its replies get no link.
 */
export function restStep(req: Request, session: AgentSession, step: IntakeView) {
  const answerUrl = consoleContextOf(req) ? undefined : answerLinkFor(session, step, publicBaseUrl(req));
  return { step, waitingFor: waitingFor(step.state), nextStep: nextStepForIntake(step, "rest", answerUrl), ...(answerUrl ? { answerUrl } : {}) };
}

export function restOrder(order: PublicOrder) {
  return { order, nextStep: nextStepForOrder(order, "rest") };
}
