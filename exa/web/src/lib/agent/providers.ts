import "server-only";

import { createAnthropicAws } from "@ai-sdk/anthropic-aws";
import { createGoogle } from "@ai-sdk/google";
import type { generateText, LanguageModel } from "ai";
import { getModel, WORKER_MODEL, type ModelInfo } from "./models";

/**
 * Claude runs through Claude Platform on AWS (Anthropic-operated, bare model ids),
 * Gemini through Google AI Studio. Both are created lazily so a missing key for one
 * family does not break the other.
 */

export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

let claude: ReturnType<typeof createAnthropicAws> | undefined;
let gemini: ReturnType<typeof createGoogle> | undefined;

function claudeProvider() {
  if (!claude) {
    const region = process.env.AWS_REGION;
    const workspaceId = process.env.ANTHROPIC_AWS_WORKSPACE_ID;
    const apiKey = process.env.ANTHROPIC_AWS_API_KEY;
    if (!region || !workspaceId || !apiKey) {
      throw new Error("Claude is not configured. Set AWS_REGION, ANTHROPIC_AWS_WORKSPACE_ID and ANTHROPIC_AWS_API_KEY in exa/.env.local.");
    }
    claude = createAnthropicAws({ region, workspaceId, apiKey });
  }
  return claude;
}

function geminiProvider() {
  if (!gemini) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Gemini is not configured. Set GOOGLE_API_KEY in exa/.env.local.");
    gemini = createGoogle({ apiKey });
  }
  return gemini;
}

export function languageModel(info: ModelInfo): LanguageModel {
  return info.provider === "claude" ? claudeProvider()(info.id) : geminiProvider()(info.id);
}

/** The fast model used for sub-agents and extraction, in the same family as the chosen model. */
export function workerModelFor(info: ModelInfo): { info: ModelInfo; model: LanguageModel } {
  const worker = getModel(WORKER_MODEL[info.provider]);
  return { info: worker, model: languageModel(worker) };
}

/**
 * Per-family request options for the main agent.
 * Claude: adaptive thinking with a readable summary, low effort so answers start quickly.
 * Gemini: light thinking, with thoughts returned so the UI can show them.
 */
export function agentProviderOptions(info: ModelInfo): ProviderOptions {
  if (info.provider === "claude") {
    return {
      anthropic: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: info.id === "claude-fable-5-2" ? "medium" : "low",
      },
    };
  }
  return { google: { thinkingConfig: { thinkingLevel: "low", includeThoughts: true } } };
}

/** Options for sub-agents: light thinking, since they still have to decide what to search and read. */
export function workerProviderOptions(info: ModelInfo): ProviderOptions {
  if (info.provider === "claude") return { anthropic: { effort: "low" } };
  return { google: { thinkingConfig: { thinkingLevel: "minimal" } } };
}

/** Options for plain extraction jobs (text in, structured data out): no thinking, for speed. */
export function extractionProviderOptions(info: ModelInfo): ProviderOptions {
  if (info.provider === "claude") return { anthropic: { thinking: { type: "disabled" }, effort: "low" } };
  return { google: { thinkingConfig: { thinkingLevel: "minimal" } } };
}
