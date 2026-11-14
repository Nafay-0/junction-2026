import { inputRequired, inputResponse, type InputRequiredResult } from "@modelcontextprotocol/server";
import { DockError } from "@/core/orders";
import type { IntakeView } from "@/core/intake";

/**
 * Some intake answers must come from the human buyer, not from the agent: confirming a likely mistake and
 * answering a clarifying question. MCP has no tool annotation for "needs a person" (annotations are only
 * readOnly/destructive/idempotent/openWorld hints). What the 2026-07-28 revision does offer is elicitation:
 * a tool answers with an `input_required` result carrying an `elicitation/create` form, the client shows it
 * to the user (not the model), and retries the call with the user's `inputResponses`.
 *
 * So these tools work two ways:
 *   - the client declared the `elicitation` capability: Dock asks the buyer directly through the client,
 *     with the agent's proposed answer (if any) pre-filled as the default; the agent cannot answer for them;
 *   - otherwise: the agent relays the question and passes the buyer's answer as arguments; the descriptions
 *     and nextStep say plainly that it must be the buyer's own answer.
 * If the client closes the form without an answer (`cancel`: dismissed, or a client that declares elicitation but
 * cannot show it), Dock lets the agent relay instead, for that request only: it asks the buyer in the chat and
 * calls again with `relay: true`. An explicit `decline` stops there.
 * The tools also carry `_meta["dock/humanInput"]` in tools/list, Dock's own (non-standard) static marker.
 */

export const HUMAN_INPUT_META = "dock/humanInput";
export const ELICIT_KEY = "buyer";

/** What a tool call knows about reaching the human through the client. */
export type HumanChannel = { canAsk: boolean; responses?: Record<string, unknown> };

/** Returned by a tool that must ask the buyer through the client before it can continue. */
export class AskHuman {
  constructor(readonly result: InputRequiredResult) {}
}

type Choice = { const: string; title: string };
type Field = { type: "string"; title: string; description?: string; oneOf: Choice[]; default?: string };

function form(message: string, fields: Record<string, Field>, by?: string, extra: Record<string, unknown> = {}): AskHuman {
  return new AskHuman(
    inputRequired({
      inputRequests: {
        [ELICIT_KEY]: inputRequired.elicit({
          message,
          requestedSchema: {
            type: "object",
            properties: { by: { type: "string", title: "Your name", minLength: 1, maxLength: 120, ...(by ? { default: by } : {}) }, ...fields, ...extra },
            required: ["by", ...Object.keys(fields)],
          },
        }),
      },
    }),
  );
}

/** The buyer's form answer on a retried call: their content, or a refusal when they declined. Undefined: not asked yet. */
function answered(human: HumanChannel): Record<string, unknown> | undefined {
  const r = inputResponse(human.responses, ELICIT_KEY);
  if (r.kind !== "elicit") return undefined;
  if (r.action === "cancel") {
    // Dismissed without a choice, or a client that declares elicitation but cannot show the form (e.g. headless).
    throw new DockError(409, "form_not_answered", "AimoPilot's form was closed without an answer. Nothing was changed.", "human_input", { action: r.action });
  }
  if (r.action !== "accept" || !r.content) {
    throw new DockError(409, "buyer_declined", "The buyer did not answer. Nothing was changed.", "human_input", { action: r.action });
  }
  return r.content;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Concerns: ask the buyer through the client, or read their answer from the retried call. */
export function concernsFromBuyer(step: IntakeView, human: HumanChannel, proposed?: { by?: string; responses?: { key: string; choice: string }[] }) {
  const content = answered(human);
  if (content) return { by: str(content.by), responses: step.concerns.map((c) => ({ key: c.key, choice: str(content[c.key]) })) };
  const fields = Object.fromEntries(
    step.concerns.map((c): [string, Field] => {
      const options = [...(c.confirmable ? [{ const: "confirm", title: "Yes, this is what I meant" }] : []), ...c.corrections.map((x) => ({ const: x.id, title: x.label }))];
      const wanted = proposed?.responses?.find((r) => r.key === c.key)?.choice;
      return [c.key, { type: "string", title: c.message, oneOf: options, ...(wanted && options.some((o) => o.const === wanted) ? { default: wanted } : {}) }];
    }),
  );
  return form("AimoPilot spotted something that may be a mistake in this order. Please check it before anything is priced.", fields, proposed?.by);
}

/** Questions: ask the buyer through the client, or read their answer from the retried call. */
export function answersFromBuyer(step: IntakeView, human: HumanChannel, proposed?: { by?: string; answers?: { questionId: string; optionId: string }[] }) {
  const questions = step.questions.length ? step.questions : step.fromMemory.map((m) => m.question);
  const content = answered(human);
  if (content) return { by: str(content.by), answers: questions.map((q) => ({ questionId: q.id, optionId: str(content[q.id]), remember: content.remember === true })) };
  const memory = new Map(step.fromMemory.map((m) => [m.question.id, m.optionId]));
  const fields = Object.fromEntries(
    questions.map((q): [string, Field] => {
      const wanted = proposed?.answers?.find((a) => a.questionId === q.id)?.optionId ?? memory.get(q.id);
      return [q.id, { type: "string", title: q.text, oneOf: q.options.map((o) => ({ const: o.id, title: o.label })), ...(wanted && q.options.some((o) => o.id === wanted) ? { default: wanted } : {}) }];
    }),
  );
  return form(`AimoPilot needs ${questions.length === 1 ? "one answer" : "your answers"} to find the right options.`, fields, proposed?.by, {
    remember: { type: "boolean", title: "Remember my answers for next time", default: false },
  });
}
