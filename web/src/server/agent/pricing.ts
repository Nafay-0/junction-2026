/**
 * Standard-tier list prices in US dollars per million tokens, for the cost estimate in a run's transcript.
 * Sources, read 2026-11-13:
 *   Anthropic  claude-api model table (platform.claude.com pricing), Haiku 5.5 rate for prompts up to 100K tokens
 *   OpenAI     https://developers.openai.com/api/docs/pricing
 *   Google     https://aistudio.google.com/docs/pricing (paid tier, text)
 * Reasoning/thinking tokens are billed as output by all three. Cached input falls back to the input price
 * when a provider publishes none. A model missing here gets `costUsd: null`; add it here or set
 * DOCK_MODEL_PRICES='{"verda:some-model":[0.2,0.6]}' (input, output per million).
 */
export type Price = { inputPerM: number; outputPerM: number; cachedInputPerM?: number };

const PRICES: Record<string, Price> = {
  "anthropic:claude-haiku-5-5": { inputPerM: 0.1, outputPerM: 0.5 },
  "anthropic:claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
  "anthropic:claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10, cachedInputPerM: 0.1 },
  "anthropic:claude-sonnet-5": { inputPerM: 2, outputPerM: 10 },
  "anthropic:claude-opus-5-5": { inputPerM: 4, outputPerM: 20, cachedInputPerM: 0.2 },
  "openai:gpt-6-luna": { inputPerM: 0.1, outputPerM: 0.5, cachedInputPerM: 0.01 },
  "openai:gpt-5.6-luna": { inputPerM: 0.2, outputPerM: 1.2, cachedInputPerM: 0.02 },
  "openai:gpt-6.1-terra": { inputPerM: 1, outputPerM: 5, cachedInputPerM: 0.05 },
  "openai:gpt-5-nano": { inputPerM: 0.05, outputPerM: 0.4, cachedInputPerM: 0.005 },
  "openai:gpt-5-mini": { inputPerM: 0.25, outputPerM: 2, cachedInputPerM: 0.025 },
  "openai:gpt-5.4-nano": { inputPerM: 0.2, outputPerM: 1.25, cachedInputPerM: 0.02 },
  "openai:gpt-5.4-mini": { inputPerM: 0.75, outputPerM: 4.5, cachedInputPerM: 0.075 },
  "google:gemini-3.1-flash-lite": { inputPerM: 0.25, outputPerM: 1.5 },
  "google:gemini-2.5-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
  "google:gemini-3.5-flash-lite": { inputPerM: 0.3, outputPerM: 2.5 },
  "google:gemini-3-flash-preview": { inputPerM: 0.5, outputPerM: 3 },
  "google:gemini-3.8-flash": { inputPerM: 0.75, outputPerM: 3.75 },
};

export function priceOf(modelId: string, env: Record<string, string | undefined> = process.env): Price | undefined {
  if (env.DOCK_MODEL_PRICES) {
    try {
      const extra = JSON.parse(env.DOCK_MODEL_PRICES) as Record<string, [number, number]>;
      const p = extra[modelId];
      if (p) return { inputPerM: p[0], outputPerM: p[1] };
    } catch {
      // ignore a malformed override; the table still applies
    }
  }
  return PRICES[modelId];
}

export type Tokens = { input: number; output: number; cachedInput: number; reasoning: number };

export const ZERO_TOKENS: Tokens = { input: 0, output: 0, cachedInput: 0, reasoning: 0 };

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cachedInput: a.cachedInput + b.cachedInput, reasoning: a.reasoning + b.reasoning };
}

/** Dollars for these tokens, or null when the price is unknown. `input` includes cached input. */
export function costOf(t: Tokens, price: Price | undefined): number | null {
  if (!price) return null;
  const cached = Math.min(t.cachedInput, t.input);
  const usd = ((t.input - cached) * price.inputPerM + cached * (price.cachedInputPerM ?? price.inputPerM) + t.output * price.outputPerM) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** AI SDK usage to our token counts; providers that omit a number count as zero. */
export function tokensFromUsage(u: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}): Tokens {
  return {
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cachedInput: u.inputTokenDetails?.cacheReadTokens ?? 0,
    reasoning: u.outputTokenDetails?.reasoningTokens ?? 0,
  };
}
