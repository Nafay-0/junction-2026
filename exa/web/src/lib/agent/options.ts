/**
 * The request options each model is sent, by job. Claude and Gemini name thinking differently,
 * and models inside one family accept different settings, so every model is decided here and
 * nowhere else.
 *
 * Three jobs:
 * - "agent": the main agent, and the writer of a research report. How hard it thinks is the
 *   user's effort dial (1 to 4), with a readable summary so the interface can show it.
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
 * The effort dial maps to Claude's `effort` (low, medium, high, xhigh) and Gemini's thinkingLevel
 * (the same four names; Carbon has no "xhigh", so its top two steps are both "high").
 *
 * `pnpm smoke options` sends one small request per model and job with exactly these options,
 * and one per step of the dial for each model that stands behind a mode.
 * Run it after changing this file or adding a model.
 *
 * No runtime imports, so the smoke script can load this file directly.
 */

import type { generateText } from "ai";
import type { Effort } from "./modes";
import type { ModelInfo } from "./models";

export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export type ModelJob = "agent" | "worker" | "extraction";

export const MODEL_JOBS: ModelJob[] = ["agent", "worker", "extraction"];

/** The effort dial, as each family names it. 1 is what answers start quickest with. */
const CLAUDE_EFFORT: Record<Effort, "low" | "medium" | "high" | "xhigh"> = { 1: "low", 2: "medium", 3: "high", 4: "xhigh" };
const GEMINI_LEVEL: Record<Effort, "low" | "medium" | "high" | "xhigh"> = { 1: "low", 2: "medium", 3: "high", 4: "xhigh" };

function claudeOptions(id: string, job: ModelJob, effort: Effort): ProviderOptions {
  switch (job) {
    case "agent":
      return {
        anthropic: {
          thinking: { type: "adaptive", display: "summarized" },
          // The dial sets the depth. Fable stands behind no mode; it keeps the room it had.
          effort: id === "claude-fable-5-2" ? "medium" : CLAUDE_EFFORT[effort],
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

function geminiOptions(id: string, job: ModelJob, effort: Effort): ProviderOptions {
  switch (job) {
    case "agent": {
      // Carbon stops at "high": the top of the dial is the same as the step below it there.
      const level = id === "gemini-4-carbon" && effort === 4 ? "high" : GEMINI_LEVEL[effort];
      return { google: { thinkingConfig: { thinkingLevel: level, includeThoughts: true } } };
    }
    case "worker":
      // "low" is the lowest level either Gemini 4 model accepts.
      return { google: { thinkingConfig: { thinkingLevel: "low" } } };
    case "extraction":
      return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  }
}

/** What a model is sent for a job. `effort` is the user's dial and only changes the "agent" job. */
export function modelOptions(info: Pick<ModelInfo, "id" | "provider">, job: ModelJob, effort: Effort = 1): ProviderOptions {
  return info.provider === "claude" ? claudeOptions(info.id, job, effort) : geminiOptions(info.id, job, effort);
}
