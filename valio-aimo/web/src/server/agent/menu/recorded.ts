import { DockError } from "@/core/errors";
import { ZERO_TOKENS } from "../pricing";
import { sanitiseDraft, type DraftResult, type LlmMenuDraft } from "./draft";
import type { FixRequest, FixResult, LlmFixes } from "./fixes";
import type { MenuPromptContext } from "./prompts";
import { RECORDINGS } from "./eval/recorded";

/**
 * Recorded model outputs: what the model returned for each request of the evaluation set, saved by
 * `pnpm menu:eval --record`. Tests replay them so the checks run on real model output without a key, and the
 * preview falls back to them when no model is configured. Model text only; nothing from the partner's catalogue.
 */
export type Recording = {
  id: string;
  kitchen: string;
  text: string;
  /** The instant the model was asked at; relative dates in the output are relative to it. */
  now: string;
  model: string;
  ms: number;
  costUsd: number | null;
  calls: DraftResult["calls"];
  raw: LlmMenuDraft;
  /** Fix proposals, by ingredient key. */
  fixes: Record<string, LlmFixes>;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöå]+/g, " ").trim();

export function findRecording(text: string): Recording | undefined {
  return RECORDINGS.find((r) => norm(r.text) === norm(text));
}

export async function recordedDraft(text: string, ctx: MenuPromptContext): Promise<DraftResult & { recorded: true }> {
  const r = findRecording(text);
  if (!r) {
    throw new DockError(503, "model_unavailable", `No model is configured, and there is no recorded output for this request. Recorded requests: ${RECORDINGS.filter((x) => ctx.kitchenName.length > 0 && x.text).map((x) => `"${x.text}"`).join(", ") || "none"}.`);
  }
  const tokens = r.calls.reduce((a, c) => ({ input: a.input + c.tokens.input, output: a.output + c.tokens.output, cachedInput: a.cachedInput + c.tokens.cachedInput, reasoning: a.reasoning + c.tokens.reasoning }), ZERO_TOKENS);
  return { draft: sanitiseDraft(r.raw), raw: r.raw, model: r.model, ms: r.ms, tokens, costUsd: r.costUsd, calls: r.calls, recorded: true };
}

export async function recordedFix(req: FixRequest): Promise<FixResult> {
  for (const r of RECORDINGS) {
    const f = r.fixes[req.lineKey];
    if (f) return { fixes: f, ms: 0, tokens: ZERO_TOKENS, costUsd: 0 };
  }
  return { fixes: { options: [] }, ms: 0, tokens: ZERO_TOKENS, costUsd: 0 };
}
