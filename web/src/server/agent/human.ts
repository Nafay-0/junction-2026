import type { Question } from "@/core/clarify";
import type { Concern } from "@/core/concerns";
import type { DockTool } from "./dock-connection";

/**
 * Human-input steps: Dock asks the buyer to confirm a likely mistake, or asks a typed question. Only the
 * buyer answers these. The runner spots such a step in any tool result, asks the `Human` callback, and
 * relays the answer through Dock's own tool for it. The model never gets to answer: a model call to one of
 * those tools is blocked and recorded as a violation.
 *
 * Everything here is recognised by shape, not by tool name, so intake tools added to Dock later are picked
 * up without changes: a step is any object in a result with `state` needs_confirmation / needs_input and a
 * `requestId`; an answering tool is one whose input takes `responses: [{ key, choice }]` (confirmation) or
 * `answers: [{ questionId, optionId }]` (questions), or that carries Dock's `dock/humanInput` marker.
 */

export type HumanPrompt =
  | { kind: "confirmation"; requestId: string; concerns: Concern[]; step: Record<string, unknown> }
  | { kind: "questions"; requestId: string; questions: Question[]; step: Record<string, unknown> };

export type HumanAnswer =
  | { by: string; responses: { key: string; choice: string }[] }
  | { by: string; answers: { questionId: string; optionId: string; remember?: boolean }[] }
  /** The buyer does not answer; the run stops with outcome awaiting_human. */
  | null;

export type Human = (prompt: HumanPrompt) => HumanAnswer | Promise<HumanAnswer>;

export type HumanToolKind = HumanPrompt["kind"];

type Schema = { properties?: Record<string, Schema>; items?: Schema; type?: string | string[] };

function itemKeys(s: Schema | undefined): string[] {
  return Object.keys(s?.items?.properties ?? {});
}

/** Dock's own marker on answering tools in tools/list (non-standard, so the schema check below also applies). */
export const HUMAN_INPUT_META = "dock/humanInput";

/** Which human-input step a tool answers, judged from its input schema (or Dock's marker); undefined for every other tool. */
export function humanToolKind(tool: DockTool): HumanToolKind | undefined {
  const props = (tool.inputSchema as Schema).properties ?? {};
  const has = (field: string, keys: string[]) => !!props[field] && keys.every((k) => itemKeys(props[field]).includes(k));
  if (has("responses", ["key", "choice"])) return "confirmation";
  if (has("answers", ["questionId", "optionId"])) return "questions";
  if (tool.meta?.[HUMAN_INPUT_META] !== undefined) return /concern|confirm/i.test(tool.name) || props.responses ? "confirmation" : "questions";
  return undefined;
}

const HUMAN_STATES: Record<string, HumanToolKind> = { needs_confirmation: "confirmation", needs_input: "questions" };

/** The first human-input step inside a tool result (searched a few levels deep), if any. */
export function findHumanStep(value: unknown, depth = 0): HumanPrompt | undefined {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findHumanStep(v, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  const o = value as Record<string, unknown>;
  const kind = typeof o.state === "string" ? HUMAN_STATES[o.state] : undefined;
  if (kind && typeof o.requestId === "string") {
    if (kind === "confirmation" && Array.isArray(o.concerns) && o.concerns.length) return { kind, requestId: o.requestId, concerns: o.concerns as Concern[], step: o };
    if (kind === "questions" && Array.isArray(o.questions) && o.questions.length) return { kind, requestId: o.requestId, questions: o.questions as Question[], step: o };
  }
  for (const v of Object.values(o)) {
    const hit = findHumanStep(v, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/** The arguments for Dock's answering tool, from the human's answer. */
export function relayArgs(prompt: HumanPrompt, answer: NonNullable<HumanAnswer>): Record<string, unknown> {
  return { requestId: prompt.requestId, ...answer };
}

/** A sensible stand-in buyer for unattended runs: confirms what can be confirmed, else takes the first correction; answers "no preference" where offered, else the first option. */
export function autoHuman(by = "Buyer (automatic stand-in)"): Human {
  return (p) =>
    p.kind === "confirmation"
      ? { by, responses: p.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : (c.corrections[0]?.id ?? "confirm") })) }
      : { by, answers: p.questions.map((q) => ({ questionId: q.id, optionId: q.options.find((o) => o.id === "no_preference")?.id ?? q.options[0].id })) };
}

/** Answers from a fixed list, in order; null once the list runs out. For tests and crash-test scenarios. */
export function scriptedHuman(answers: (HumanAnswer | Human)[]): Human & { asked: HumanPrompt[] } {
  const asked: HumanPrompt[] = [];
  const fn = (async (p: HumanPrompt) => {
    asked.push(p);
    const next = answers[asked.length - 1];
    if (next === undefined) return null;
    return typeof next === "function" ? next(p) : next;
  }) as Human & { asked: HumanPrompt[] };
  fn.asked = asked;
  return fn;
}

/** A buyer who never answers. */
export const absentHuman: Human = () => null;
