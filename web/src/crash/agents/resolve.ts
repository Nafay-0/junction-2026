import type { RunCaps } from "@/server/agent/runner";
import { agentByName } from ".";
import { modelAgent } from "./model";
import type { CrashAgent } from "./types";

export const FEATHERLESS_BASE = "https://api.featherless.ai/v1";

/**
 * Any agent name the CLI accepts: a scripted agent, `model:<provider:model-id>`, or `featherless:<model-id>` for an
 * open model on Featherless's OpenAI-compatible API (FEATHERLESS_API_KEY). `caps` override the model runner's caps
 * per session; `episodeCostUsd` caps the spend of the whole episode (all its sessions).
 */
export function resolveAgent(name: string, opts: { caps?: Partial<RunCaps>; episodeCostUsd?: number; env?: Record<string, string | undefined> } = {}): CrashAgent {
  const env = opts.env ?? process.env;
  if (name.startsWith("featherless:")) {
    const id = name.slice("featherless:".length);
    const apiKey = env.FEATHERLESS_API_KEY?.trim();
    if (!apiKey) throw new Error("Set FEATHERLESS_API_KEY to run Featherless models.");
    // Featherless caps output per call at 4096 tokens for several models; the runner's default asks for 8192.
    return modelAgent(`compat:${id}`, { name, modelOptions: { baseURL: FEATHERLESS_BASE, apiKey }, caps: { maxOutputTokensPerTurn: 4096, ...opts.caps }, episodeCostUsd: opts.episodeCostUsd });
  }
  if (name.startsWith("model:") && (opts.caps || opts.episodeCostUsd !== undefined)) return modelAgent(name.slice("model:".length), { caps: opts.caps, episodeCostUsd: opts.episodeCostUsd });
  return agentByName(name);
}
