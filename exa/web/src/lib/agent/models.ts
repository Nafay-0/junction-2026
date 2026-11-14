/**
 * The models a user can pick, with prices. Shared by the server and the browser:
 * nothing here reads environment variables or imports a provider.
 *
 * Prices are US dollars per million tokens at list price (read 14 Nov 2026).
 * Claude runs through Claude Platform on AWS, where the bill comes through AWS, so treat the
 * dollar figures as an estimate.
 */

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

export const DEFAULT_MODEL_ID = "claude-opus-5-5";

/** The model sub-agents and small extraction jobs run on, per provider family: fast and cheap. */
export const WORKER_MODEL: Record<ModelProvider, string> = {
  claude: "claude-haiku-5-5",
  gemini: "gemini-4-hydrogen",
};

export function getModel(id: string | undefined | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

export const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };

/** Dollar cost of a model call. `inputTokens` is the total input including cached tokens. */
export function costOf(modelId: string, usage: TokenUsage): number {
  const { price } = getModel(modelId);
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  return (
    (fresh * price.input + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite + usage.outputTokens * price.output) /
    1_000_000
  );
}

/** What each assistant message reports about itself. Sent as message metadata and shown in the UI. */
export type RunStats = {
  modelId: string;
  modelLabel: string;
  startedAt: number;
  durationMs?: number;
  steps?: number;
  usage?: TokenUsage;
  /** Model cost for the main agent, in US dollars. */
  llmCostUsd?: number;
  /** Tokens and cost of sub-agents and helper calls made inside tools. */
  workerUsage?: TokenUsage;
  workerCostUsd?: number;
  /** Exa spend and call counts. */
  exaCostUsd?: number;
  exaCalls?: { search: number; contents: number; agent: number; answer: number };
  /** Set when older tool results were trimmed to keep the conversation inside the context window. */
  contextTrimmed?: boolean;
  finishReason?: string;
};
