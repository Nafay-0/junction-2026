import { generateText, Output, type LanguageModel } from "ai";
import { recordLlmSpend, reserveLlmCall } from "@/server/limits";
import { costOf, tokensFromUsage, type Price } from "./pricing";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { createModel, defaultModel, ModelConfigError } from "./models";
import { assistantSystem, assistantUser } from "./prompts";
import { describeError, isRetryable, withRetry } from "./retry";

/**
 * The shop assistant's answers: questions about what is on screen, in the catalogue and in the kitchen's own
 * records ("is this gluten-free?", "why was that order held?"), answered ONLY from records that plain code
 * retrieved and handed over, each with an id. The model must cite the ids it used; plain code drops any id it
 * was not given. It never orders anything: a purchase request is handed back as such, to the staged order flow.
 */

/** One piece of data the answer may rest on: a product's facts, an order, a memory item, the mandate, a live check. */
export type AssistantRecord = { id: string; kind: "product" | "order" | "memory" | "mandate" | "live"; label: string; data: Record<string, unknown> };

const LlmAnswer = z.object({
  kind: z.enum(["answer", "order_request", "out_of_scope"]),
  answer: z.string(),
  citations: z.array(z.string()),
  dataMissing: z.boolean().describe("true when the records do not say what was asked"),
});
export type LlmAnswer = z.infer<typeof LlmAnswer>;

export type AssistantAnswer = { kind: LlmAnswer["kind"]; answer: string; citations: string[]; dataMissing: boolean; model: string; ms: number };

export type AskOptions = {
  question: string;
  records: AssistantRecord[];
  /** What the buyer is looking at, in a few words ("the product page of 460100"). */
  screen?: string;
  /** The last few turns, oldest first, so "and is it vegan?" has its subject. */
  history?: { q: string; a: string }[];
  model?: string | { model: LanguageModel; id: string };
  timeoutMs?: number;
};

export async function askAssistant(opts: AskOptions): Promise<AssistantAnswer> {
  const question = opts.question.trim();
  if (!question) throw new DockError(400, "invalid_request", "The question is empty.");
  let model: LanguageModel;
  let id: string;
  let price: Price | undefined;
  if (opts.model && typeof opts.model !== "string") ({ model, id } = opts.model);
  else {
    const spec = opts.model ?? defaultModel("DOCK_ASSISTANT_MODEL") ?? defaultModel("DOCK_INTERPRET_MODEL");
    if (!spec) throw new DockError(503, "model_unavailable", "No model is configured for the assistant.");
    try {
      const m = createModel(spec);
      model = m.model;
      id = m.spec.id;
      price = m.price;
    } catch (err) {
      if (err instanceof ModelConfigError) throw new DockError(503, "model_unavailable", err.message);
      throw err;
    }
  }
  reserveLlmCall(); // public-demo caps: daily calls and spend, and the DOCK_LLM=off switch (server/limits.ts)
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  let res;
  try {
    res = await withRetry(
      () =>
        generateText({
          model,
          instructions: assistantSystem(),
          prompt: assistantUser({ question, records: opts.records, screen: opts.screen, history: (opts.history ?? []).slice(-4) }),
          output: Output.object({ schema: LlmAnswer, name: "grounded_answer", description: "An answer from the given records only, with the ids it rests on." }),
          maxOutputTokens: 1200,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      { deadline, policy: { maxRetries: 1, baseMs: 400, maxMs: 2000 } },
    );
  } catch (err) {
    if (Date.now() >= deadline || (err as Error)?.name === "TimeoutError") throw new DockError(504, "assistant_timeout", `The assistant did not answer within ${timeoutMs} ms.`);
    throw new DockError(isRetryable(err) ? 503 : 502, "assistant_failed", `The model call failed: ${describeError(err)}`);
  }
  recordLlmSpend(costOf(tokensFromUsage(res.usage), price));
  return { ...checkAnswer(res.output as LlmAnswer, opts.records), model: id, ms: Date.now() - t0 };
}

/** Plain code after the model: only ids it was given, and an answer with no citation is marked as such. */
export function checkAnswer(raw: LlmAnswer, records: AssistantRecord[]): Omit<AssistantAnswer, "model" | "ms"> {
  const known = new Set(records.map((r) => r.id));
  const citations = [...new Set(raw.citations.filter((c) => known.has(c)))];
  const answer = raw.answer.trim().slice(0, 1500);
  if (raw.kind === "answer" && citations.length === 0 && !raw.dataMissing) {
    return { kind: "answer", answer: `${answer} (No record cited: treat this as unconfirmed.)`, citations, dataMissing: true };
  }
  return { kind: raw.kind, answer, citations, dataMissing: raw.dataMissing };
}
