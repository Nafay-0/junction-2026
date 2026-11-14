/**
 * What each answer reports about itself: how long it took and what it used. Shared by the server
 * and the browser. It names a mode, never a model: which model stood behind a mode is recorded on
 * the server for the admin, and is not sent to the interface.
 */

import type { Effort, ModeId } from "./modes";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

export const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };

export type ExaCalls = { search: number; contents: number; agent: number; answer: number };

/** Sent as message metadata. An account that may not see usage gets only the mode and the times. */
export type RunStats = {
  /** The mode that answered, or "voice" for what was said in a live call. */
  mode?: ModeId | "voice";
  effort?: Effort;
  startedAt: number;
  durationMs?: number;
  steps?: number;
  usage?: TokenUsage;
  /** What the answering model cost, in US dollars. For a live call this is the cost of the voice. */
  llmCostUsd?: number;
  /** Tokens and cost of sub-agents and helper calls made inside tools. */
  workerUsage?: TokenUsage;
  workerCostUsd?: number;
  /** Exa spend and call counts. */
  exaCostUsd?: number;
  exaCalls?: ExaCalls;
  /** What checking pages against wishes cost (the decision model behind sift), and how many requests it took. */
  decisionCostUsd?: number;
  decisionCalls?: number;
  /** Set when older tool results were trimmed to keep the conversation inside the context window. */
  contextTrimmed?: boolean;
  finishReason?: string;
  /** Set when the task was stopped because the account reached the usage limit its admin set. */
  capReached?: boolean;
  /**
   * Answers written before modes existed carried the model here. Nothing shows them any more;
   * they are read only to tell an old voice answer from an old typed one.
   */
  modelId?: string;
  modelLabel?: string;
};

/** True for what was said in a live call, old answers included. */
export const isVoice = (stats: RunStats | undefined): boolean => stats?.mode === "voice" || (stats?.mode === undefined && /-live$/.test(stats?.modelId ?? ""));

/* ───────────────────────── What it cost, by kind ───────────────────────── */

/** The four things an answer can spend money on. */
export type Spend = { exa: number; llm: number; voice: number; decisions: number };

export const NO_SPEND: Spend = { exa: 0, llm: 0, voice: 0, decisions: 0 };

export const SPEND_LABELS: Array<{ key: keyof Spend; label: string }> = [
  { key: "llm", label: "LLMs" },
  { key: "exa", label: "Exa" },
  { key: "voice", label: "Voice" },
  { key: "decisions", label: "Decisions" },
];

/** An answer's cost, split by kind. Helpers and sub-agents count as LLMs whoever asked for them. */
export function spendOf(stats: RunStats | undefined): Spend {
  if (!stats) return { ...NO_SPEND };
  const voice = isVoice(stats);
  return {
    exa: stats.exaCostUsd ?? 0,
    llm: (voice ? 0 : (stats.llmCostUsd ?? 0)) + (stats.workerCostUsd ?? 0),
    voice: voice ? (stats.llmCostUsd ?? 0) : 0,
    decisions: stats.decisionCostUsd ?? 0,
  };
}

export const totalSpend = (spend: Spend): number => spend.exa + spend.llm + spend.voice + spend.decisions;

export function addSpend(a: Spend, b: Spend): Spend {
  return { exa: a.exa + b.exa, llm: a.llm + b.llm, voice: a.voice + b.voice, decisions: a.decisions + b.decisions };
}

/* ───────────────────────── One answer, or a whole conversation, summed up ───────────────────────── */

/** What was used, in the shape the interface shows it: money by kind, and the counts behind each kind. */
export type UsageSummary = {
  spend: Spend;
  /** Tokens read and written by the answering model and its helpers; `cached` is the part of `in` read from cache. */
  llmTokens: { in: number; out: number; cached: number };
  /** Tokens heard and spoken in live calls. */
  voiceTokens: { in: number; out: number };
  exaCalls: ExaCalls;
  decisionCalls: number;
  steps: number;
  durationMs: number;
  contextTrimmed: boolean;
};

export const NO_USAGE: UsageSummary = {
  spend: NO_SPEND,
  llmTokens: { in: 0, out: 0, cached: 0 },
  voiceTokens: { in: 0, out: 0 },
  exaCalls: { search: 0, contents: 0, agent: 0, answer: 0 },
  decisionCalls: 0,
  steps: 0,
  durationMs: 0,
  contextTrimmed: false,
};

export function summarise(stats: RunStats | undefined): UsageSummary {
  if (!stats) return NO_USAGE;
  const voice = isVoice(stats);
  const main = stats.usage ?? EMPTY_USAGE;
  const helpers = stats.workerUsage ?? EMPTY_USAGE;
  return {
    spend: spendOf(stats),
    llmTokens: {
      in: (voice ? 0 : main.inputTokens) + helpers.inputTokens,
      out: (voice ? 0 : main.outputTokens) + helpers.outputTokens,
      cached: voice ? 0 : main.cacheReadTokens,
    },
    voiceTokens: { in: voice ? main.inputTokens : 0, out: voice ? main.outputTokens : 0 },
    exaCalls: stats.exaCalls ?? NO_USAGE.exaCalls,
    decisionCalls: stats.decisionCalls ?? 0,
    steps: stats.steps ?? 0,
    durationMs: stats.durationMs ?? 0,
    contextTrimmed: stats.contextTrimmed === true,
  };
}

export function addSummaries(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    spend: addSpend(a.spend, b.spend),
    llmTokens: { in: a.llmTokens.in + b.llmTokens.in, out: a.llmTokens.out + b.llmTokens.out, cached: a.llmTokens.cached + b.llmTokens.cached },
    voiceTokens: { in: a.voiceTokens.in + b.voiceTokens.in, out: a.voiceTokens.out + b.voiceTokens.out },
    exaCalls: {
      search: a.exaCalls.search + b.exaCalls.search,
      contents: a.exaCalls.contents + b.exaCalls.contents,
      agent: a.exaCalls.agent + b.exaCalls.agent,
      answer: a.exaCalls.answer + b.exaCalls.answer,
    },
    decisionCalls: a.decisionCalls + b.decisionCalls,
    steps: a.steps + b.steps,
    durationMs: a.durationMs + b.durationMs,
    contextTrimmed: a.contextTrimmed || b.contextTrimmed,
  };
}

export const exaCallCount = (calls: ExaCalls): number => calls.search + calls.contents + calls.agent + calls.answer;

/** True when the figures of an answer were sent at all: an account that may not see usage gets only the mode and the time. */
export const hasFigures = (stats: RunStats | undefined): boolean => Boolean(stats && (stats.usage || stats.llmCostUsd !== undefined || stats.exaCalls || stats.exaCostUsd !== undefined));
