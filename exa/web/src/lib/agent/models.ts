/**
 * The models behind the modes, with prices. Server only in practice: the interface knows modes
 * (`modes.ts`) and never imports this file, so no model's name reaches the browser.
 * Nothing here reads environment variables or imports a provider, and there are no runtime
 * imports, so the smoke script can load the file directly.
 *
 * Prices are US dollars per million tokens at list price (read 14 Nov 2026).
 * Claude runs through Claude Platform on AWS, where the bill comes through AWS, so treat the
 * dollar figures as an estimate.
 */

import type { ModeId } from "./modes";
import type { TokenUsage } from "./stats";

export type { RunStats, TokenUsage } from "./stats";

export type ModelProvider = "claude" | "gemini";

export type ModelInfo = {
  id: string;
  label: string;
  provider: ModelProvider;
  /** One line shown in the picker. */
  blurb: string;
  /** Per million tokens. */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "claude",
    blurb: "Best all-round. The default.",
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "claude",
    blurb: "Faster and cheaper, still strong.",
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "claude",
    blurb: "Fastest Claude. Good for simple lookups.",
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  },
  {
    id: "claude-fable-5-2",
    label: "Claude Fable 5.2",
    provider: "claude",
    blurb: "Most capable. Slower; for hard research.",
    price: { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  },
  {
    // Google's list price through 30 Nov 2026; it doubles on 1 Dec 2026.
    id: "gemini-4-carbon",
    label: "Gemini 4 Carbon",
    provider: "gemini",
    blurb: "Google's most capable reasoning model.",
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2 },
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    provider: "gemini",
    blurb: "Google's fast everyday model.",
    price: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 1.5 },
  },
];

/**
 * Which model answers in each mode, from the quickest to the most capable. This is the only place
 * that ties a mode to a model. Voice and the decision model are not modes and are not chosen here.
 */
export const MODE_MODEL: Record<ModeId, string> = {
  ultrafast: "gemini-4-hydrogen",
  fast: "claude-sonnet-5-5",
  smart: "claude-opus-5-5",
  expert: "gemini-4-carbon",
};

export const DEFAULT_MODEL_ID = MODE_MODEL.smart;

/** The model behind a mode. */
export function modelForMode(mode: ModeId): ModelInfo {
  return getModel(MODE_MODEL[mode]);
}

/** The mode a model stands behind, if any: for figures recorded before modes existed. */
export function modeOfModel(modelId: string | undefined | null): ModeId | undefined {
  return (Object.keys(MODE_MODEL) as ModeId[]).find((mode) => MODE_MODEL[mode] === modelId);
}

/** The model sub-agents and small extraction jobs run on, per provider family: fast and cheap. */
export const WORKER_MODEL: Record<ModelProvider, string> = {
  claude: "claude-haiku-5-5",
  gemini: "gemini-4-hydrogen",
};

export function getModel(id: string | undefined | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

/** Dollar cost of a model call. `inputTokens` is the total input including cached tokens. */
export function costOf(modelId: string, usage: TokenUsage): number {
  const { price } = getModel(modelId);
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  return (
    (fresh * price.input + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite + usage.outputTokens * price.output) /
    1_000_000
  );
}
