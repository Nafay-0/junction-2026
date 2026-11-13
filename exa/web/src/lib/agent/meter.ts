import type { LanguageModelUsage } from "ai";
import type { ExaMeter } from "@/lib/exa/client";
import { costOf, EMPTY_USAGE, type RunStats, type TokenUsage } from "./models";

/** Convert the AI SDK's usage object to our flat shape. */
export function toTokenUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  if (!usage) return { ...EMPTY_USAGE };
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/**
 * Tracks what one user request costs: Exa calls, plus the tokens spent by helper model
 * calls and sub-agents that run inside tools. The main agent's own usage comes from the
 * AI SDK when the stream finishes and is added in the route.
 */
export class RunMeter implements ExaMeter {
  readonly startedAt = Date.now();
  exaCostUsd = 0;
  exaCalls = { search: 0, contents: 0, agent: 0, answer: 0 };
  workerUsage: TokenUsage = { ...EMPTY_USAGE };
  workerCostUsd = 0;
  contextTrimmed = false;

  addExa(costUsd: number, kind: "search" | "contents" | "agent" | "answer") {
    this.exaCostUsd += costUsd;
    this.exaCalls[kind] += 1;
  }

  /** Record a helper or sub-agent model call. */
  addWorker(modelId: string, usage: LanguageModelUsage | undefined) {
    const flat = toTokenUsage(usage);
    this.workerUsage = addUsage(this.workerUsage, flat);
    this.workerCostUsd += costOf(modelId, flat);
  }

  snapshot(): Pick<RunStats, "exaCostUsd" | "exaCalls" | "workerUsage" | "workerCostUsd" | "contextTrimmed"> {
    return {
      exaCostUsd: round(this.exaCostUsd),
      exaCalls: { ...this.exaCalls },
      workerUsage: { ...this.workerUsage },
      workerCostUsd: round(this.workerCostUsd),
      contextTrimmed: this.contextTrimmed || undefined,
    };
  }
}

export function round(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
