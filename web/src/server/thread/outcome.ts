import type { AgentTurn, Card } from "./types";

/**
 * How an agent turn ended, as stable codes for the operations scorecard (never the buyer's words):
 *   turn_done   outcome answered | asked | ordered | sent_for_signoff | refused (with the gate rule's code)
 *   turn_failed code model_error | model_timeout | tool_error | engine_error | empty_reply, and the turn's duration
 */
export type TurnOutcome = "answered" | "asked" | "ordered" | "sent_for_signoff" | "refused";
export type TurnFailure = "model_error" | "model_timeout" | "tool_error" | "engine_error" | "empty_reply";

/** The outcome of a finished turn, from its status and its cards (a refusal wins, then a sign-off, then an order). */
export function turnOutcome(status: AgentTurn["status"], cards: readonly Card[]): { outcome: TurnOutcome; rule?: string } {
  const refused = cards.find((c) => c.type === "gate" && c.outcome === "refused");
  if (refused?.type === "gate") return { outcome: "refused", ...(refused.rule ? { rule: refused.rule } : {}) };
  if (status === "waiting_approver" || cards.some((c) => c.type === "gate" && c.outcome === "waiting")) return { outcome: "sent_for_signoff" };
  if (cards.some((c) => c.type === "order" || (c.type === "gate" && c.outcome === "placed_alone"))) return { outcome: "ordered" };
  if (status === "waiting_buyer") return { outcome: "asked" };
  return { outcome: "answered" };
}

/** Why a turn failed, from the error (and its causes): the model's own failure, a timeout, a tool, or our code. */
export function failureOf(err: unknown): TurnFailure {
  const chain: unknown[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) chain.push(e);
  const named = (re: RegExp) => chain.some((e) => re.test(String((e as { name?: unknown }).name ?? "")) || re.test(String((e as { code?: unknown }).code ?? "")));
  const said = (re: RegExp) => chain.some((e) => re.test(String((e as { message?: unknown }).message ?? "")));
  if (named(/Timeout|Abort/i) || said(/timed? ?out|timeout|aborted/i)) return "model_timeout";
  if (named(/ToolExecution|ToolCall|InvalidToolInput|NoSuchTool/i)) return "tool_error";
  if (named(/^AI_|APICall|Retry|NoOutputGenerated|NoContentGenerated|agent_unavailable|LoadAPIKey/i)) return "model_error";
  return "engine_error";
}
