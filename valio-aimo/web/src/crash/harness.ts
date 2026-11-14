import { z } from "zod";
import { sha256Hex } from "@/core/util";
import { buyerAgentSystem } from "@/server/agent/prompts";
import { MCP_INSTRUCTIONS } from "@/server/mcp/server";
import { TOOLS } from "@/server/mcp/tools";

/**
 * What a crash-test licence is about: a model in a harness. The same model behaves differently with another system
 * prompt or tool table, so a licence names both, and the gate honours it only for an agent bound to the same pair.
 *
 * The harness id of Dock's own buyer agent (src/server/agent/runner.ts) is a digest of what the model is told and
 * given: the runner's system prompt, Dock's server instructions and the tool table (names, descriptions, schemas).
 * It moves when any of those changes, and an earlier licence then stops counting until the suite is re-run.
 * Caps (steps, spend, time) are configuration, not harness, and are left out.
 */
export type Harness = { id: string; name: string; digest: string };

let cached: Harness | undefined;

export function dockRunnerHarness(): Harness {
  if (cached) return cached;
  const prompt = buyerAgentSystem({ today: "2000-01-01", weekday: "Saturday", serverInstructions: MCP_INSTRUCTIONS });
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input, { io: "input" }) }));
  const digest = sha256Hex(JSON.stringify({ prompt, tools })).slice(0, 12);
  cached = { id: `dock-runner@${digest}`, name: "dock-runner", digest };
  return cached;
}

/** The harness a crash agent ran in: Dock's runner for models, the agent's own code for scripted agents. */
export function harnessOf(agentName: string): string {
  return agentName.startsWith("model:") || agentName.startsWith("featherless:") ? dockRunnerHarness().id : `scripted:${agentName}`;
}

/** The model a crash agent names, as `provider:model-id`, or null for a scripted agent. */
export function modelOf(agentName: string): string | null {
  if (agentName.startsWith("model:")) return agentName.slice("model:".length);
  if (agentName.startsWith("featherless:")) return `featherless:${agentName.slice("featherless:".length)}`;
  return null;
}
