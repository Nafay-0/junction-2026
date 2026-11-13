import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

/**
 * A scripted stand-in for a model, for tests and dry runs of the crash test: each turn is a function of
 * what the model has seen so far (the prompt, including Dock's tool results) and returns text, tool calls,
 * or throws (to play a provider error). It runs through the real AI SDK, so the runner's message handling
 * is exercised exactly as with a live provider.
 */

export type ScriptedTurn = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] };
export type ScriptStep = ScriptedTurn | ((seen: Seen) => ScriptedTurn);

export type Seen = {
  /** The latest structured result of a tool, by tool name. */
  last: (toolName: string) => Record<string, unknown> | undefined;
  /** All tool results so far, oldest first. */
  results: { toolName: string; value: unknown; isError: boolean }[];
  /** User turns so far (the task and anything the runner relayed). */
  userTexts: string[];
  options: LanguageModelV4CallOptions;
};

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function seenFrom(options: LanguageModelV4CallOptions): Seen {
  const results: Seen["results"] = [];
  const userTexts: string[] = [];
  for (const m of options.prompt) {
    if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type !== "tool-result") continue;
        const o = p.output as { type: string; value?: unknown };
        results.push({ toolName: p.toolName, value: o.value, isError: o.type.startsWith("error") });
      }
    }
    if (m.role === "user") for (const p of m.content) if (p.type === "text") userTexts.push(p.text);
  }
  return {
    last: (name) => [...results].reverse().find((r) => r.toolName === name)?.value as Record<string, unknown> | undefined,
    results,
    userTexts,
    options,
  };
}

export function scriptedModel(script: ScriptStep[], opts: { inputTokens?: number; outputTokens?: number; id?: string } = {}) {
  let turn = 0;
  let callSeq = 0;
  const model = new MockLanguageModelV4({
    provider: "scripted",
    modelId: opts.id ?? "scripted",
    doGenerate: async (options): Promise<LanguageModelV4GenerateResult> => {
      const stepDef = script[Math.min(turn, script.length - 1)];
      turn++;
      const t = typeof stepDef === "function" ? stepDef(seenFrom(options)) : stepDef;
      const content: LanguageModelV4GenerateResult["content"] = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const c of t.calls ?? []) content.push({ type: "tool-call", toolCallId: `call_${++callSeq}`, toolName: c.name, input: JSON.stringify(c.args) });
      return {
        content,
        finishReason: { unified: t.calls?.length ? "tool-calls" : "stop", raw: undefined },
        usage: usage(opts.inputTokens ?? 1000, opts.outputTokens ?? 50),
        warnings: [],
      };
    },
  });
  return { model, id: `scripted:${opts.id ?? "scripted"}`, turns: () => turn };
}
