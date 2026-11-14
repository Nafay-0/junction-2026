/**
 * The request options each model is sent, by job. Claude and Gemini name thinking differently,
 * and models inside one family accept different settings, so every model is decided here and
 * nowhere else.
 *
 * Three jobs:
 * - "agent": the main agent, and the writer of a research report. Light thinking, with a
 *   readable summary so the interface can show it.
 * - "worker": a research sub-agent. Light thinking: it still has to decide what to search.
 * - "extraction": text in, structured data out. Thinking off where the model allows it.
 *
 * What the models accept (checked against the live APIs on 14 Nov 2026):
 * - Claude Opus 5.5, Sonnet 5.5, Fable 5.2: thinking cannot be switched off with
 *   { type: "disabled" } (the request is rejected). Depth is set with `effort` alone.
 * - Claude Haiku 5.5: thinking can be disabled at effort "high" or below.
 * - Gemini 4 Carbon: thinkingLevel "low", "medium" or "high". "minimal" and "xhigh" are rejected.
 * - Gemini 4 Hydrogen: thinkingLevel "low" to "xhigh". "minimal" is rejected.
 * - Both Gemini 4 models: thinkingBudget 0 switches thinking off.
 *
 * `pnpm smoke options` sends one small request per model and job with exactly these options.
 * Run it after changing this file or adding a model.
 *
 * No runtime imports, so the smoke script can load this file directly.
 */

import type { generateText } from "ai";
import type { ModelInfo } from "./models";

export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export type ModelJob = "agent" | "worker" | "extraction";

export const MODEL_JOBS: ModelJob[] = ["agent", "worker", "extraction"];

function claudeOptions(id: string, job: ModelJob): ProviderOptions {
  switch (job) {
    case "agent":
      return {
        anthropic: {
          thinking: { type: "adaptive", display: "summarized" },
          // Low effort so answers start quickly; Fable is picked for hard questions, so it gets more room.
          effort: id === "claude-fable-5-2" ? "medium" : "low",
        },
      };
    case "worker":
      // Thinking is left at the model's default (adaptive); low effort keeps it short.
      return { anthropic: { effort: "low" } };
    case "extraction":
      // Only Haiku lets thinking be switched off. The others reject it, so they get low effort instead.
      return id === "claude-haiku-5-5" ? { anthropic: { thinking: { type: "disabled" }, effort: "low" } } : { anthropic: { effort: "low" } };
  }
}

function geminiOptions(_id: string, job: ModelJob): ProviderOptions {
  switch (job) {
    case "agent":
      return { google: { thinkingConfig: { thinkingLevel: "low", includeThoughts: true } } };
    case "worker":
      // "low" is the lowest level either Gemini 4 model accepts.
      return { google: { thinkingConfig: { thinkingLevel: "low" } } };
    case "extraction":
      return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  }
}

export function modelOptions(info: Pick<ModelInfo, "id" | "provider">, job: ModelJob): ProviderOptions {
  return info.provider === "claude" ? claudeOptions(info.id, job) : geminiOptions(info.id, job);
}
