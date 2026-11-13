import { autoHuman, type Human } from "@/server/agent/human";
import { runBuyerAgent, type ModelChoice, type RunCaps } from "@/server/agent/runner";
import type { DockConnection } from "@/server/agent/dock-connection";
import { MCP_INSTRUCTIONS } from "@/server/mcp/server";
import type { AgentEnv } from "../env";
import { reportFromText } from "../report-text";
import type { CrashAgent, Harness } from "./types";

/**
 * Model agents, through the model runner in src/server/agent (owned by another branch; used, not changed).
 * The runner drives the model in a plain tool loop against a DockConnection. Here that connection is the crash
 * environment: the same tool table, run by the same code, plus ask_human and finish. Dock's server instructions
 * reach the model as they would over MCP, with the scenario's briefing in front of them.
 *
 * Human channels:
 *   - ask_human is an ordinary tool: the scenario's scripted human answers it.
 *   - Dock's own intake prompts (mistake checks, typed questions) come to the runner's Human callback; we answer
 *     them like a reasonable buyer (confirm what is confirmable, "no preference" where offered) and record them.
 *   - Calls where the model tried to answer those prompts itself are blocked by the runner; we count them.
 */

/** Caps per scenario run: enough steps for the longest scenario, spend capped so a full suite stays cheap. */
export const CRASH_CAPS: Partial<RunCaps> = { maxSteps: 24, maxCostUsd: 0.05, maxWallMs: 240_000, graceSteps: 3 };

export function connectionFor(env: AgentEnv): DockConnection {
  return {
    instructions: `${env.briefing}\n\n${MCP_INSTRUCTIONS}`,
    tools: () => env.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })),
    async call(name, args) {
      const r = await env.call(name, args);
      return { ok: r.ok, structured: r, text: JSON.stringify(r) };
    },
    close: async () => undefined,
  };
}

function recordingHuman(h: Harness): Human {
  const answer = autoHuman("Buyer");
  return async (prompt) => {
    const a = await answer(prompt);
    const asked = prompt.kind === "confirmation" ? prompt.concerns.map((c) => c.message) : prompt.questions.map((q) => q.text);
    h.recordIntake(prompt.kind, asked, a);
    return a;
  };
}

export function modelAgent(model: ModelChoice, opts: { name?: string; caps?: Partial<RunCaps>; modelOptions?: Parameters<typeof runBuyerAgent>[0]["modelOptions"] } = {}): CrashAgent {
  const id = typeof model === "string" ? model : model.id;
  return {
    name: opts.name ?? `model:${id}`,
    kind: "model",
    description: `${id} through the model runner (src/server/agent).`,
    async run(env, harness) {
      const result = await runBuyerAgent({
        model,
        task: env.task.text,
        dock: connectionFor(env),
        human: recordingHuman(harness),
        caps: { ...CRASH_CAPS, ...opts.caps },
        now: () => new Date(harness.start),
        modelOptions: opts.modelOptions,
      });
      harness.noteAnsweredForHuman(result.violations);
      if (!env.done && result.finalText) harness.reportFromText(reportFromText(result.finalText, await harness.orderIds()));
      return {
        model: result.model,
        transcript: result,
        costUsd: result.costUsd,
        tokens: { input: result.tokens.input, output: result.tokens.output, total: result.tokens.total },
        answeredForHuman: result.violations,
        finalText: result.finalText,
        outcome: result.outcome,
      };
    },
  };
}
