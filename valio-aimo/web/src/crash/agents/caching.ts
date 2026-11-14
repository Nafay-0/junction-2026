import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { createModel, parseModelSpec, type ModelOptions } from "@/server/agent/models";
import type { ModelChoice } from "@/server/agent/runner";

/**
 * Prompt caching for Anthropic models, added from outside the runner: a model middleware marks the system prompt
 * and the newest message as cache breakpoints, so each turn of the tool loop reads the tool table, the briefing and
 * the history so far from the cache instead of paying for them again. It changes the bill, not what the model sees:
 * the request content is identical. OpenAI and Gemini cache long prefixes on their own.
 *
 * The runner (src/server/agent/runner.ts) should do this itself; until it does, crash-test runs of Anthropic models
 * pass the wrapped model as a ModelChoice object. Without it a frontier model's full suite costs 10-20x more.
 */
const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

type PromptMessage = { role: string; content: unknown; providerOptions?: Record<string, unknown> };

export const anthropicCacheMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const prompt = (params.prompt as unknown as PromptMessage[]).map((m) => ({ ...m }));
    const mark = (m: PromptMessage | undefined) => {
      if (!m) return;
      if (Array.isArray(m.content) && m.content.length) {
        const parts = [...(m.content as { providerOptions?: Record<string, unknown> }[])];
        const last = parts.length - 1;
        parts[last] = { ...parts[last], providerOptions: { ...parts[last].providerOptions, ...EPHEMERAL } };
        m.content = parts;
      } else m.providerOptions = { ...m.providerOptions, ...EPHEMERAL };
    };
    mark(prompt.findLast((m) => m.role === "system"));
    mark(prompt.findLast((m) => m.role !== "system"));
    return { ...params, prompt: prompt as unknown as typeof params.prompt };
  },
};

/** The model the crash test runs: Anthropic models wrapped with prompt caching, every other model as the runner makes it. */
export function crashModelChoice(spec: string, modelOptions?: ModelOptions): ModelChoice {
  if (parseModelSpec(spec).provider !== "anthropic") return spec;
  const { model, spec: s, price } = createModel(spec, modelOptions);
  return { model: wrapLanguageModel({ model: model as Exclude<LanguageModel, string>, middleware: anthropicCacheMiddleware }), id: s.id, price };
}
