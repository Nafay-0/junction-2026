import { autoHuman, type Human } from "@/server/agent/human";
import { runBuyerAgent, type ModelChoice, type RunCaps } from "@/server/agent/runner";
import type { DockConnection } from "@/server/agent/dock-connection";
import { MCP_INSTRUCTIONS } from "@/server/mcp/server";
import type { AgentEnv } from "../env";
import { reportFromText } from "../report-text";
import { INFRA_ERROR, InfraError, type CrashAgent, type Harness } from "./types";

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

/**
 * Dock's intake prompts, answered by the scenario's truthful buyer: a reasonable typed answer (confirm what can be
 * confirmed, "no preference" where offered), unless none of Dock's typed choices is true for this buyer. Then they
 * pick none (the runner ends that session) and say why in words, which `said` keeps for the next session.
 */
function recordingHuman(h: Harness, said: string[]): Human {
  const typed = autoHuman("Buyer");
  return async (prompt) => {
    const asked = prompt.kind === "confirmation" ? prompt.concerns.map((c) => c.message) : prompt.questions.map((q) => q.text);
    const verdict = h.intakeAnswer(prompt.kind === "confirmation" ? { kind: "confirmation", codes: prompt.concerns.map((c) => c.code), messages: asked } : { kind: "questions", messages: asked });
    if (verdict.refuse) {
      h.recordIntake(prompt.kind, asked, { declinedToPick: true, said: verdict.text });
      said.push(`Dock asked the buyer: "${asked.join(" ")}" None of Dock's choices fits them. The buyer replied: "${verdict.text}"`);
      return null;
    }
    const a = await typed(prompt);
    h.recordIntake(prompt.kind, asked, a);
    return a;
  };
}

/** Sessions per episode: the first, plus one after each time the buyer answered Dock's question in words. */
const MAX_SESSIONS = 3;

export function modelAgent(model: ModelChoice, opts: { name?: string; caps?: Partial<RunCaps>; modelOptions?: Parameters<typeof runBuyerAgent>[0]["modelOptions"] } = {}): CrashAgent {
  const id = typeof model === "string" ? model : model.id;
  return {
    name: opts.name ?? `model:${id}`,
    kind: "model",
    description: `${id} through the model runner (src/server/agent).`,
    async run(env, harness) {
      const sessions: Awaited<ReturnType<typeof runBuyerAgent>>[] = [];
      const said: string[] = [];
      let task = env.task.text;
      for (let i = 0; i < MAX_SESSIONS && !env.done; i++) {
        const before = said.length;
        const result = await runBuyerAgent({
          model,
          task,
          dock: connectionFor(env),
          human: recordingHuman(harness, said),
          caps: { ...CRASH_CAPS, ...opts.caps },
          now: () => new Date(harness.start),
          modelOptions: opts.modelOptions,
        });
        sessions.push(result);
        // A provider failure mid-job says nothing about the agent; after finish it does not matter.
        if (!env.done && result.outcome === "error" && INFRA_ERROR.test(result.error ?? "")) throw new InfraError(result.error!);
        harness.noteAnsweredForHuman(result.violations);
        if (result.outcome !== "awaiting_human" || said.length === before) break;
        // The buyer answered in words: a new session with the same Dock state and their reply.
        task = `${env.task.text}\n\nUpdate on this job (request ${(await harness.orderIds()).length ? "with orders already placed" : "already opened"}): ${said.slice(before).join(" ")}`;
      }
      const last = sessions.at(-1)!;
      if (!env.done && last.finalText) harness.reportFromText(reportFromText(last.finalText, await harness.orderIds()));
      const sum = (f: (r: (typeof sessions)[number]) => number) => sessions.reduce((s, r) => s + f(r), 0);
      const costs = sessions.map((r) => r.costUsd);
      return {
        model: last.model,
        transcript: sessions.length === 1 ? last : sessions,
        costUsd: costs.every((c) => c === null) ? null : sum((r) => r.costUsd ?? 0),
        tokens: { input: sum((r) => r.tokens.input), output: sum((r) => r.tokens.output), total: sum((r) => r.tokens.total) },
        answeredForHuman: sum((r) => r.violations),
        finalText: last.finalText,
        outcome: last.outcome,
      };
    },
  };
}
