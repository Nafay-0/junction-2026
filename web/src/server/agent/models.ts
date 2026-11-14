import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { priceOf, type Price } from "./pricing";
import { scriptedEnabled, scriptedModel } from "./scripted";

/**
 * One string picks a model: `provider:model-id`.
 *
 *   anthropic:claude-haiku-5-5        ANTHROPIC_API_KEY
 *   openai:gpt-6-luna                 OPENAI_API_KEY (Responses API)
 *   google:gemini-3.1-flash-lite      GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY)
 *   compat:<model-id>                 any OpenAI-compatible endpoint: OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_API_KEY
 *   verda:<model-id>                  VERDA_BASE_URL, VERDA_API_KEY            (OpenAI-compatible)
 *   nvidia:<model-id>                 NVIDIA_BASE_URL (default NVIDIA's hosted API), NVIDIA_API_KEY (OpenAI-compatible)
 *
 * A base URL and key passed in code win over the environment. Model ids are passed through unchanged, so a
 * new model needs no code change; only its price (pricing.ts) is needed for the cost estimate.
 */

export type Provider = "anthropic" | "openai" | "google" | "compat" | "verda" | "nvidia" | "scripted";
const PROVIDERS: Provider[] = ["anthropic", "openai", "google", "compat", "verda", "nvidia", "scripted"];

/** Cheapest suitable model per provider, checked against each provider's model list and pricing page on 2026-11-13. */
export const CHEAP_DEFAULTS: Record<"anthropic" | "openai" | "google", string> = {
  anthropic: "anthropic:claude-haiku-5-5",
  openai: "openai:gpt-6-luna",
  google: "google:gemini-3.1-flash-lite",
};

export type ModelSpec = { provider: Provider; modelId: string; id: string };

export type ModelOptions = { baseURL?: string; apiKey?: string; env?: Record<string, string | undefined> };

export class ModelConfigError extends Error {
  constructor(
    message: string,
    readonly code: "model_spec_invalid" | "model_key_missing",
  ) {
    super(message);
  }
}

export function parseModelSpec(spec: string): ModelSpec {
  const i = spec.indexOf(":");
  const provider = (i > 0 ? spec.slice(0, i) : "") as Provider;
  const modelId = i > 0 ? spec.slice(i + 1).trim() : "";
  if (!PROVIDERS.includes(provider) || !modelId) {
    throw new ModelConfigError(`Model must be "provider:model-id" with provider one of ${PROVIDERS.join(", ")}; got "${spec}".`, "model_spec_invalid");
  }
  return { provider, modelId, id: `${provider}:${modelId}` };
}

type Endpoint = { keyVars: string[]; baseVar?: string; defaultBase?: string };
const ENDPOINTS: Record<Provider, Endpoint> = {
  anthropic: { keyVars: ["ANTHROPIC_API_KEY"] },
  openai: { keyVars: ["OPENAI_API_KEY"] },
  google: { keyVars: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"] },
  compat: { keyVars: ["OPENAI_COMPATIBLE_API_KEY"], baseVar: "OPENAI_COMPATIBLE_BASE_URL" },
  verda: { keyVars: ["VERDA_API_KEY"], baseVar: "VERDA_BASE_URL" },
  nvidia: { keyVars: ["NVIDIA_API_KEY"], baseVar: "NVIDIA_BASE_URL", defaultBase: "https://integrate.api.nvidia.com/v1" },
  // Recorded answers for the end-to-end demo (scripted.ts): opt-in with DOCK_SCRIPTED_MODELS=1 and a recordings file.
  scripted: { keyVars: ["DOCK_SCRIPTED_RECORDINGS"] },
};

function keyFor(provider: Provider, env: Record<string, string | undefined>): string | undefined {
  for (const v of ENDPOINTS[provider].keyVars) if (env[v]) return env[v];
  return undefined;
}

/** True when the environment holds a key (and, for compatible endpoints, a base URL) for this provider. */
export function hasCredentials(provider: Provider, env: Record<string, string | undefined> = process.env): boolean {
  if (provider === "scripted") return scriptedEnabled(env);
  const e = ENDPOINTS[provider];
  return !!keyFor(provider, env) && (!e.baseVar || !!(env[e.baseVar] || e.defaultBase));
}

export function createModel(spec: string | ModelSpec, opts: ModelOptions = {}): { model: LanguageModel; spec: ModelSpec; price: Price | undefined } {
  const s = typeof spec === "string" ? parseModelSpec(spec) : spec;
  const env = opts.env ?? process.env;
  if (s.provider === "scripted") {
    if (!scriptedEnabled(env)) throw new ModelConfigError("Scripted models need DOCK_SCRIPTED_MODELS=1 and DOCK_SCRIPTED_RECORDINGS.", "model_key_missing");
    return { model: scriptedModel(s.modelId), spec: s, price: { inputPerM: 0, outputPerM: 0 } };
  }
  const apiKey = opts.apiKey ?? keyFor(s.provider, env);
  if (!apiKey) throw new ModelConfigError(`No API key for ${s.provider}: set ${ENDPOINTS[s.provider].keyVars.join(" or ")}.`, "model_key_missing");
  const e = ENDPOINTS[s.provider];
  const baseURL = opts.baseURL ?? (e.baseVar ? env[e.baseVar] || e.defaultBase : undefined);
  let model: LanguageModel;
  switch (s.provider) {
    case "anthropic":
      model = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(s.modelId);
      break;
    case "openai":
      model = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(s.modelId);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(s.modelId);
      break;
    default:
      if (!baseURL) throw new ModelConfigError(`No base URL for ${s.provider}: set ${e.baseVar}.`, "model_key_missing");
      model = createOpenAICompatible({ name: s.provider, baseURL, apiKey, includeUsage: true, supportsStructuredOutputs: true })(s.modelId);
  }
  return { model, spec: s, price: priceOf(s.id, env) };
}

/** The first configured model among: an explicit choice, an environment variable, then the cheap default of each provider with a key. */
export function defaultModel(envVar: string, env: Record<string, string | undefined> = process.env): string | undefined {
  if (env[envVar]) return env[envVar];
  for (const p of ["anthropic", "openai", "google"] as const) if (hasCredentials(p, env)) return CHEAP_DEFAULTS[p];
  return undefined;
}
